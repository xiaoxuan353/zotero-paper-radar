import { getString } from "../utils/locale";
import { getConfig, setPrefAny } from "./config";
import { fetchFeed, makePaperId, withinDays } from "./rss";
import type { FeedEntry } from "./rss";
import { evaluatePaper } from "./llm";
import { enrichFromCrossref } from "./crossref";
import { loadProcessed, saveProcessed } from "./dedup";
import { existsInLibrary, getOrCreateCollection, savePaper } from "./writer";

let running = false;

export function isRunning(): boolean {
  return running;
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
    if (!cfg.apiKey) {
      showPopup(getString("progress-nokey"), "fail");
      return;
    }
    progress
      .createLine({
        text: getString("progress-fetching"),
        progress: 0,
      })
      .show();

    const processed = await loadProcessed();

    // Fetch all feeds concurrently; failures only log and skip that feed.
    const settled = await Promise.allSettled(cfg.feeds.map(fetchFeed));
    const byId = new Map<string, FeedEntry>();
    let feedFailures = 0;
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") {
        for (const entry of result.value) {
          if (!entry.title) {
            continue;
          }
          if (!withinDays(entry, cfg.daysLimit)) {
            continue;
          }
          const id = makePaperId(entry);
          if (processed[id]) {
            continue;
          }
          // First occurrence wins across feeds.
          if (!byId.has(id)) {
            byId.set(id, entry);
          }
        }
      } else {
        feedFailures++;
        ztoolkit.log(`Feed failed: ${cfg.feeds[i]} (${result.reason})`);
      }
    });

    const entries = Array.from(byId.values());
    if (entries.length === 0) {
      progress.changeLine({
        text: getString("progress-none", { args: { days: cfg.daysLimit } }),
        progress: 100,
      });
      progress.startCloseTimer(5000);
      return;
    }
    if (feedFailures > 0) {
      ztoolkit.log(`${feedFailures} feed(s) failed this run`);
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
      const review = await evaluatePaper(cfg, entry.title, entry.abstract);
      done++;
      if (review) {
        if (review.level === "high" || review.level === "mid") {
          hits.push({ entry, review: review.text, level: review.level });
        } else {
          // Low/unknown relevance: remember and skip.
          lowCount++;
          processed[makePaperId(entry)] = Date.now();
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

    let saved = 0;
    let highSaved = 0;
    let midSaved = 0;
    for (const hit of hits) {
      const alreadyExists = await existsInLibrary(
        hit.entry.doi,
        hit.entry.title,
      );
      if (alreadyExists) {
        processed[makePaperId(hit.entry)] = Date.now();
        continue;
      }
      const meta = await enrichFromCrossref(hit.entry.title, hit.entry.doi);
      const item = await savePaper(
        hit.entry,
        meta,
        hit.review,
        hit.level,
        collectionKey,
        cfg.researchTag,
      );
      if (item) {
        processed[makePaperId(hit.entry)] = Date.now();
        saved++;
        if (hit.level === "high") {
          highSaved++;
        } else {
          midSaved++;
        }
      }
    }

    await saveProcessed(processed);
    setPrefAny("autoRun.lastRun", Date.now());
    progress.changeLine({
      text: getString("progress-done", {
        args: {
          evaluated: done,
          saved,
          high: highSaved,
          mid: midSaved,
          low: lowCount,
        },
      }),
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
