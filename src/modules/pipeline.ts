import { getString } from "../utils/locale";
import {
  computeCriteriaFingerprint,
  getConfig,
  getDedupFingerprint,
  setDedupFingerprint,
  setLastRun,
} from "./config";
import { fetchFeed, makePaperId, normalizeTitle, withinDays } from "./rss";
import type { FeedEntry } from "./rss";
import { evaluatePaper } from "./llm";
import {
  backfillAbstract,
  clearAbstractCache,
  resetAbstractBudget,
  saveAbstractCache,
} from "./abstracts";
import { enrichFromCrossref, scanJournalByIssn } from "./crossref";
import type { JournalSpec } from "./config";
import { backupProcessed, loadProcessed, saveProcessed } from "./dedup";
import { existsInLibrary, getOrCreateCollection, savePaper } from "./writer";

let running = false;

export function isRunning(): boolean {
  return running;
}

/**
 * Newest entries of a feed, dated first. Used by the stale-source fallback:
 * "最新录用 / online-first" feeds (e.g. 中国公路学报) sometimes carry dates far
 * older than the recency window, which used to make the whole source vanish.
 */
export function newestEntries(
  entries: FeedEntry[],
  limit: number,
): FeedEntry[] {
  return [...entries]
    .sort((a, b) => {
      const ta = a.published ? a.published.getTime() : Number.NEGATIVE_INFINITY;
      const tb = b.published ? b.published.getTime() : Number.NEGATIVE_INFINITY;
      return tb - ta;
    })
    .slice(0, limit);
}

/**
 * True if an entry was already processed, recognized under EITHER its own id
 * (DOI/url-based) or the canonical normalized-title key. This lets a paper
 * discovered by one source block the same paper coming from another source,
 * even when one copy has no DOI (e.g. ScienceDirect RSS vs Crossref).
 */
function isProcessed(map: Record<string, number>, entry: FeedEntry): boolean {
  if (map[makePaperId(entry)]) {
    return true;
  }
  return Boolean(map[`title:${normalizeTitle(entry.title)}`]);
}

/**
 * Record an entry as processed under BOTH its own id and a canonical
 * normalized-title key, so a later run / other source sees it as handled.
 */
function markProcessed(map: Record<string, number>, entry: FeedEntry): void {
  const now = Date.now();
  map[makePaperId(entry)] = now;
  map[`title:${normalizeTitle(entry.title)}`] = now;
}

/**
 * Add a candidate entry to the in-flight dedup map. Skips already-processed
 * entries, and de-duplicates by canonical title ACROSS sources. When the same
 * paper arrives from both a title-only RSS copy and a Crossref copy that
 * carries a DOI, the DOI-bearing (complete) copy wins.
 */
function addEntry(
  byId: Map<string, FeedEntry>,
  titleOwner: Map<string, string>,
  processed: Record<string, number>,
  entry: FeedEntry,
): void {
  const id = makePaperId(entry);
  if (!entry.title || processed[id]) {
    return;
  }
  const t = normalizeTitle(entry.title);
  if (!t || processed[`title:${t}`]) {
    return;
  }
  const ownerId = titleOwner.get(t);
  if (ownerId !== undefined) {
    const existing = byId.get(ownerId);
    if (entry.doi && existing && !existing.doi) {
      byId.delete(ownerId);
      byId.set(id, entry);
      titleOwner.set(t, id);
    }
    return;
  }
  titleOwner.set(t, id);
  if (!byId.has(id)) {
    byId.set(id, entry);
  }
}

/**
 * Full pipeline: fetch feeds -> filter -> dedup -> LLM evaluation ->
 * save high/mid papers into Zotero. Re-entrancy guarded.
 */
export async function runPipeline(): Promise<void> {
  if (running) {
    showPopup(getString("progress-running"), "fail");
    return;
  }
  running = true;
  const progress = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  });
  try {
    const cfg = getConfig();
    resetAbstractBudget();
    if (!cfg.apiKey) {
      showPopup(getString("progress-nokey"), "fail");
      setLastRun();
      return;
    }
    progress
      .createLine({
        text: getString("progress-fetching"),
        progress: 0,
      })
      .show();

    let processed = await loadProcessed();

    // A verdict only means something under the criteria it was made with.
    // When the direction / criteria / model changed, drop the old records
    // (after a backup) so papers judged "low" under looser-or-stricter rules
    // get a second look instead of staying buried for 90 days.
    const fingerprint = computeCriteriaFingerprint(cfg);
    const storedFingerprint = getDedupFingerprint();
    // Two triggers for a reset: the rules genuinely changed, or this is the
    // first run after upgrading to a build that has fingerprints at all (the
    // stored verdicts were made by the older, stricter evaluation path).
    const rulesChanged =
      Boolean(storedFingerprint) && storedFingerprint !== fingerprint;
    const upgradeMigration =
      !storedFingerprint && Object.keys(processed).length > 0;
    if (rulesChanged || upgradeMigration) {
      const cleared = Object.keys(processed).length;
      const backedUp = cleared > 0 ? await backupProcessed(processed) : true;
      if (backedUp) {
        processed = {};
        // Persist the reset before fetching, otherwise an early exit (no feeds,
        // no new papers) would leave the old verdicts on disk while the
        // fingerprint already claims they were dropped.
        const persisted = await saveProcessed(processed);
        if (persisted) {
          setDedupFingerprint(fingerprint);
          // Old runs may have recorded "no abstract" misses before an Elsevier
          // key existed; a rules change is a good moment to retry them.
          clearAbstractCache();
          ztoolkit.log(
            (rulesChanged
              ? `Evaluation rules changed (${storedFingerprint} -> ${fingerprint})`
              : "First run after upgrade: evaluation path changed") +
              `; cleared ${cleared} processed record(s) for re-evaluation` +
              (cleared > 0 ? " (backup: paperRadarProcessed.prev.json)" : ""),
          );
        } else {
          ztoolkit.log(
            "Evaluation rules changed but the cleared record file could not be written; retrying next run",
          );
        }
      } else {
        ztoolkit.log(
          `Evaluation rules changed but the processed-record backup failed; ` +
            `keeping ${cleared} old record(s) and retrying next run`,
        );
      }
    } else if (!storedFingerprint) {
      setDedupFingerprint(fingerprint);
    }

    // Fetch all feeds concurrently; failures only log and skip that feed.
    const settled = await Promise.allSettled(
      cfg.feeds.map((url) => fetchFeed(url)),
    );
    const byId = new Map<string, FeedEntry>();
    const titleOwner = new Map<string, string>();
    let feedFailures = 0;
    let staleRescued = 0;
    let staleDropped = 0;
    let emptyFeeds = 0;
    settled.forEach((result, i) => {
      if (result.status !== "fulfilled") {
        feedFailures++;
        ztoolkit.log(`Feed failed: ${cfg.feeds[i]} (${result.reason})`);
        return;
      }
      const items = result.value.filter((entry) => entry.title);
      if (items.length === 0) {
        emptyFeeds++;
        ztoolkit.log(`Feed returned no items: ${cfg.feeds[i]}`);
        return;
      }
      const fresh = items.filter((entry) => withinDays(entry, cfg.daysLimit));
      let candidates = fresh;
      if (fresh.length === 0) {
        // "最新录用 / online first" feeds sometimes publish stale dates, which
        // made the whole source invisible. Take its newest few once; dedup
        // guarantees they are never evaluated twice.
        if (cfg.staleFallback) {
          candidates = newestEntries(items, cfg.staleFallbackLimit);
          staleRescued++;
          ztoolkit.log(
            `Feed had no items inside the ${cfg.daysLimit}-day window; ` +
              `falling back to its newest ${candidates.length}: ${cfg.feeds[i]}`,
          );
        } else {
          staleDropped++;
          ztoolkit.log(
            `Feed had no items inside the ${cfg.daysLimit}-day window: ${cfg.feeds[i]}`,
          );
        }
      }
      for (const entry of candidates) {
        addEntry(byId, titleOwner, processed, entry);
      }
    });

    // Human-readable source health, surfaced in the result popup: a source
    // that silently contributes nothing is the hardest failure to notice.
    const healthNotes: string[] = [];
    if (feedFailures > 0) {
      healthNotes.push(`${feedFailures} 个源抓取失败`);
    }
    if (emptyFeeds > 0) {
      healthNotes.push(`${emptyFeeds} 个源无条目`);
    }
    if (staleRescued > 0) {
      healthNotes.push(
        `${staleRescued} 个源无新文已补抓最新 ${cfg.staleFallbackLimit} 条`,
      );
    }
    if (staleDropped > 0) {
      healthNotes.push(`${staleDropped} 个源无新文`);
    }
    if (healthNotes.length > 0) {
      ztoolkit.log(`Source health: ${healthNotes.join("；")}`);
    }

    // Crossref-by-ISSN scanning: covers journals with no RSS and catches
    // Ahead-of-Print earlier. Shares the same DOI-based dedup map above.
    let crossrefFailures = 0;
    if (cfg.crossrefEnable && cfg.crossrefJournals.length > 0) {
      progress.changeLine({
        text: getString("progress-crossref"),
        progress: 0,
      });
      const crConcurrency = Math.min(5, cfg.crossrefJournals.length);
      await runWithPool(
        cfg.crossrefJournals,
        crConcurrency,
        async (journal) => {
          const result = await scanJournalByIssn(
            journal.issn,
            journal.name,
            cfg.crossrefRows,
            cfg.daysLimit,
          );
          if (!result.ok) {
            crossrefFailures++;
            return;
          }
          for (const entry of result.entries) {
            if (!entry.title) {
              continue;
            }
            if (!withinDays(entry, cfg.daysLimit)) {
              continue;
            }
            addEntry(byId, titleOwner, processed, entry);
          }
        },
      );
    }

    const entries = Array.from(byId.values());
    const healthSuffix =
      healthNotes.length > 0 ? ` · ${healthNotes.join("；")}` : "";
    if (entries.length === 0) {
      // No new papers this run: still count it as a completed run, otherwise
      // autoRun.lastRun stays stale (0) and the scheduler triggers on every
      // startup regardless of the configured interval.
      setLastRun();
      progress.changeLine({
        text:
          getString("progress-none", { args: { days: cfg.daysLimit } }) +
          healthSuffix,
        progress: 100,
      });
      progress.startCloseTimer(5000);
      return;
    }
    if (cfg.crossrefEnable) {
      const crTotal = cfg.crossrefJournals.length;
      ztoolkit.log(
        `Crossref scan finished: ${Math.max(0, crTotal - crossrefFailures)} ok, ${crossrefFailures} fail`,
      );
    }
    progress.changeLine({
      text: getString("progress-collect", { args: { count: entries.length } }),
      progress: 5,
    });

    const collection = await getOrCreateCollection(cfg.collectionName);
    const collectionKey = collection?.key || "";

    let done = 0;
    let lowCount = 0;
    const hits: { entry: FeedEntry; review: string; level: "high" | "mid" }[] =
      [];
    await runWithPool(entries, cfg.workers, async (entry) => {
      // Feeds rarely ship abstracts (Elsevier/T&F never do). Fill the gap so
      // the model is not judging a whole journal by title alone.
      let abstract = entry.abstract;
      if (!abstract.trim()) {
        const lookup = await backfillAbstract(
          entry.doi,
          entry.title,
          cfg.elsevierApiKey,
        );
        if (lookup.abstract) {
          abstract = lookup.abstract;
          ztoolkit.log(
            `Abstract for "${entry.title.slice(0, 40)}" from ${lookup.source}`,
          );
        }
      }
      const review = await evaluatePaper(cfg, entry.title, abstract);
      done++;
      if (review) {
        if (review.level === "high" || review.level === "mid") {
          hits.push({ entry, review: review.text, level: review.level });
        } else if (review.level === "low") {
          // Confirmed low relevance: remember and skip.
          lowCount++;
          markProcessed(processed, entry);
        } else {
          // review.level === "unknown": format parsing failed.
          // Do NOT mark as processed so the paper is retried on next run,
          // avoiding false-negative permanent dropping of relevant papers.
          ztoolkit.log(
            `Unrecognized review rating for "${entry.title}": ${review.text.slice(0, 60)}`,
          );
        }
      }
      // review === null means evaluation error: leave unmarked so the
      // paper is retried on the next run.
      progress.changeLine({
        text: getString("progress-evaluating", {
          args: {
            done,
            total: entries.length,
            title: entry.title.slice(0, 40),
          },
        }),
        progress: 5 + Math.round((done / entries.length) * 80),
      });
    });

    // Persist decisions made during evaluation (low / already-known) so a
    // long write phase below can't lose them on an unexpected exit; otherwise
    // those papers would be re-evaluated and billed again on the next run.
    await saveProcessed(processed);

    let saved = 0;
    let highSaved = 0;
    let midSaved = 0;
    let checkpoint = 0;
    for (const hit of hits) {
      checkpoint++;
      // Periodically persist so a crash mid-write only ever loses a few
      // remaining items, not the entire run's progress.
      if (checkpoint % 10 === 0) {
        await saveProcessed(processed);
      }
      // Cheap duplicate check with whatever DOI/url the entry already has.
      if (await existsInLibrary(hit.entry.doi, hit.entry.title)) {
        markProcessed(processed, hit.entry);
        continue;
      }
      const meta = await enrichFromCrossref(hit.entry.title, hit.entry.doi);
      const resolvedDoi = meta.DOI || hit.entry.doi;
      // Re-check after enrichment against the resolved DOI — an RSS copy may
      // have only gained a DOI after CrossRef filled it in, and we must not
      // write a duplicate of an item that already exists in the library.
      if (
        resolvedDoi !== hit.entry.doi &&
        (await existsInLibrary(resolvedDoi, hit.entry.title))
      ) {
        markProcessed(processed, hit.entry);
        continue;
      }
      // Strict-metadata guard: don't create an "orphan" item with neither
      // creators nor a DOI (which Linter would flag). Defer it instead so the
      // next run retries and backfills it once enrichment succeeds.
      if (cfg.strictMetadata && !resolvedDoi) {
        const hasAuthors =
          (Array.isArray(hit.entry.authors) && hit.entry.authors.length > 0) ||
          (Array.isArray(meta.authors) && meta.authors.length > 0);
        if (!hasAuthors) {
          ztoolkit.log(
            `Deferred "${hit.entry.title}": no creators and no DOI after ` +
              `Crossref enrichment; will retry on next run.`,
          );
          continue;
        }
      }
      const item = await savePaper(
        hit.entry,
        meta,
        hit.review,
        hit.level,
        collectionKey,
        cfg.researchTag,
      );
      if (item) {
        markProcessed(processed, hit.entry);
        saved++;
        if (hit.level === "high") {
          highSaved++;
        } else {
          midSaved++;
        }
      }
    }

    await saveProcessed(processed);
    await saveAbstractCache();
    setLastRun();
    progress.changeLine({
      text:
        getString("progress-done", {
          args: {
            evaluated: done,
            saved,
            high: highSaved,
            mid: midSaved,
            low: lowCount,
          },
        }) + healthSuffix,
      progress: 100,
    });
    progress.startCloseTimer(8000);
  } catch (err) {
    ztoolkit.log(`Pipeline error: ${err}`);
    try {
      progress.changeLine({ text: String(err), type: "fail" });
      progress.startCloseTimer(6000);
    } catch {
      // Progress window may not be usable here.
    }
    setLastRun();
  } finally {
    running = false;
  }
}

function showPopup(text: string, type: "fail" | "default" = "default") {
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({ text, type, progress: 100 })
    .show()
    .startCloseTimer(6000);
}

/**
 * Promise-based worker pool, replacement of Python's ThreadPoolExecutor.
 */
async function runWithPool<T>(
  tasks: T[],
  limit: number,
  worker: (task: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, tasks.length));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      await worker(task);
    }
  });
  await Promise.all(runners);
}
