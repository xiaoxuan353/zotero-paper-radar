export interface EnrichedMeta {
  DOI?: string;
  publicationTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  date?: string;
  authors?: string[];
}

/**
 * Fill missing metadata (journal, volume, issue, pages, date) from Crossref.
 * Failures are non-fatal: the item is saved with whatever is known.
 */
const CROSSREF_MAILTO = "paper-radar@zotero.plugin";

export async function enrichFromCrossref(
  title: string,
  doi: string,
): Promise<EnrichedMeta> {
  // Chinese domestic journals are not reliably indexed in Crossref.
  // Fuzzy title queries against Crossref for Chinese titles return false positives
  // (e.g. assigning economics metadata to civil engineering papers).
  if (!doi && /[\u4e00-\u9fa5]/.test(title)) {
    return {};
  }

  const url = doi
    ? `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${CROSSREF_MAILTO}`
    : `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=1&mailto=${CROSSREF_MAILTO}`;
  try {
    const resp = await Zotero.HTTP.request("GET", url, {
      responseType: "json",
      timeout: 10000,
    });
    let msg = (resp.response as any)?.message;
    if (Array.isArray(msg?.items) && msg.items.length > 0) {
      const candidate = msg.items[0];
      const candTitle = firstOrString(candidate?.title);
      if (!isTitleSimilar(title, candTitle)) {
        ztoolkit.log(
          `Crossref title mismatch: "${title}" vs "${candTitle}", skipping enrichment`,
        );
        return {};
      }
      msg = candidate;
    } else if (!doi) {
      return {};
    }
    const out: EnrichedMeta = {};
    if (msg?.DOI) {
      out.DOI = String(msg.DOI);
    }
    const container = msg?.["container-title"];
    if (Array.isArray(container) && container.length > 0) {
      out.publicationTitle = String(container[0]);
    }
    if (msg?.volume) {
      out.volume = String(msg.volume);
    }
    if (msg?.issue) {
      out.issue = String(msg.issue);
    }
    if (msg?.page) {
      out.pages = String(msg.page);
    }
    const dateParts =
      msg?.["published-print"]?.["date-parts"]?.[0] ??
      msg?.["published-online"]?.["date-parts"]?.[0];
    if (Array.isArray(dateParts) && dateParts.length > 0) {
      out.date = dateParts.map(String).join("-");
    }
    const authors = parseCrossrefAuthors(msg);
    if (authors.length > 0) {
      out.authors = authors;
    }
    return out;
  } catch (err) {
    ztoolkit.log(`Crossref enrichment skipped: ${err}`);
    return {};
  }
}

export interface JournalScanResult {
  entries: ScanEntry[];
  ok: boolean;
}

/**
 * A Crossref work normalized into a shape compatible with FeedEntry so the
 * rest of the pipeline (dedup, evaluation, saving) can treat it identically.
 */
export interface ScanEntry {
  title: string;
  abstract: string;
  url: string;
  published: Date | null;
  doi: string;
  feedUrl: string;
  /** Author names, best-effort from Crossref author[] (given + family). */
  authors: string[];
  /** Journal display name. */
  journalTitle?: string;
}

const CROSSREF_BASE = "https://api.crossref.org/journals";

/**
 * Scan the most recent works of one journal by ISSN via the Crossref REST API.
 *
 * Uses select to reduce payload size, sorts newest-first, and filters on the
 * service side to only works published within the last `daysLimit` days
 * (filter=from-pub-date), so high-volume journals are not truncated by `rows`.
 * `rows` is now just a safety cap (Crossref allows up to 1000). Recency is
 * still double-checked downstream by withinDays() as a backstop.
 * Retries transient network failures (SSL EOF, 429) with exponential backoff
 * + jitter. Concurrency should stay <= 5 to respect the Crossref polite pool.
 *
 * Returns ok=false when every attempt fails (the run still continues).
 */
export async function scanJournalByIssn(
  issn: string,
  name: string,
  rows: number,
  daysLimit: number,
  attempts = 3,
): Promise<JournalScanResult> {
  const params = new URLSearchParams({
    rows: String(rows),
    sort: "published",
    order: "desc",
    filter: `from-pub-date:${isoDateDaysAgo(daysLimit)}`,
    // request level metadata only; abstracts come for many records
    select:
      "DOI,title,author,abstract,container-title,published-print,published-online,issued,type",
    mailto: CROSSREF_MAILTO,
  });
  const url = `${CROSSREF_BASE}/${encodeURIComponent(issn)}/works?${params}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await Zotero.HTTP.request("GET", url, {
        responseType: "json",
        timeout: 30000,
      });
      const msg = (resp.response as any)?.message;
      const items: any[] = Array.isArray(msg?.items) ? msg.items : [];
      const entries: ScanEntry[] = [];
      for (const item of items) {
        const title = firstOrString(item?.title);
        if (!title) {
          continue;
        }
        const itemType = String(item?.type || "").trim();
        if (isIgnoredWork(itemType, title)) {
          continue;
        }
        const doi = String(item?.DOI || "").trim();
        // Collect all rows; window filtering happens in the pipeline via the
        // well-tested withinDays(). A break here is unsafe because Crossref's
        // sort key (published = online-first) can differ from a paper's
        // print date, so stopping early could drop recent online-first items.
        entries.push({
          title,
          abstract: cleanAbstract(String(item?.abstract || "")),
          url: doi ? `https://doi.org/${doi}` : "",
          published: publishedFromWork(item),
          doi,
          feedUrl: name,
          authors: parseCrossrefAuthors(item),
          journalTitle: name,
        });
      }
      return { entries, ok: true };
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        await backoff(attempt);
      }
    }
  }
  ztoolkit.log(`Crossref scan failed for ${name} (${issn}): ${lastErr}`);
  return { entries: [], ok: false };
}

/**
 * Backoff with jitter: base * 2^n seconds, plus random 0..500ms.
 */
function backoff(attempt: number): Promise<void> {
  const delayMs =
    Math.min(30000, 500 * 2 ** (attempt - 1)) + Math.random() * 500;
  return Zotero.Promise.delay(delayMs);
}

export interface JournalProbe {
  issn: string;
  name: string;
  ok: boolean;
  message: string;
}

/**
 * Probe whether an ISSN is a valid journal in Crossref. The /journals/{issn}
 * endpoint returns 404 for an unknown ISSN and 400 for a malformed one.
 */
export async function probeJournalIssn(
  issn: string,
  name: string,
): Promise<JournalProbe> {
  const url = `${CROSSREF_BASE}/${encodeURIComponent(issn)}?mailto=${CROSSREF_MAILTO}`;
  // Retry transient failures (rate-limit/5xx) so a temporary blip doesn't get
  // reported as "invalid journal". 404/400 are permanent and fail fast.
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await Zotero.HTTP.request("GET", url, {
        responseType: "json",
        timeout: 20000,
      });
      const msg = (resp.response as any)?.message;
      const title = String(msg?.["title"] || msg?.["name"] || "").trim();
      return {
        issn,
        name,
        ok: true,
        message: title
          ? title
          : "Valid ISSN, but no journal title returned (unusual)",
      };
    } catch (err: any) {
      // Zotero.HTTP.request rejects on non-2xx by default. 404/400 mean the
      // ISSN is genuinely invalid and we fail fast; everything else (429/5xx/
      // network) is transient and retried with backoff.
      const status =
        Number(err?.status) ||
        Number(err?.xhr?.status) ||
        Number(err?.response?.status) ||
        0;
      if (status === 404 || status === 400) {
        return status === 404
          ? fail(
              issn,
              name,
              "No such journal in Crossref (404) — check the ISSN",
            )
          : fail(
              issn,
              name,
              "Malformed ISSN (400) — must be 8 digits, no hyphens",
            );
      }
      if (attempt < attempts) {
        await backoff(attempt);
        continue;
      }
      return fail(issn, name, `Error: ${err}`);
    }
  }
  return fail(issn, name, "Unexpected failure probing journal");
}

function fail(issn: string, name: string, message: string): JournalProbe {
  return { issn, name, ok: false, message };
}

function firstOrString(v: any): string {
  if (Array.isArray(v)) {
    return String(v[0] || "").trim();
  }
  return String(v || "").trim();
}

/**
 * Check if candidate title from Crossref fuzzy query is sufficiently similar
 * to the query title, preventing spurious matches from corrupting metadata.
 */
function isTitleSimilar(t1: string, t2: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const n1 = normalize(t1);
  const n2 = normalize(t2);
  if (!n1 || !n2) {
    return false;
  }
  if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) {
    return true;
  }
  const w1 = new Set(n1.split(/\s+/));
  const w2 = new Set(n2.split(/\s+/));
  let intersect = 0;
  for (const w of w1) {
    if (w2.has(w)) {
      intersect++;
    }
  }
  const union = new Set([...w1, ...w2]).size;
  return union > 0 && intersect / union >= 0.6;
}

function parseCrossrefAuthors(work: any): string[] {
  if (!Array.isArray(work?.author)) {
    return [];
  }
  const out: string[] = [];
  for (const a of work.author) {
    const given = String(a?.given || "").trim();
    const family = String(a?.family || "").trim();
    if (given && family) {
      out.push(`${family}, ${given}`);
    } else if (family) {
      out.push(family);
    } else {
      const name = String(a?.name || "").trim();
      if (name) {
        out.push(name);
      }
    }
  }
  return out;
}

/**
 * Resolve the latest publication date among online/print/issued so that
 * online-first (Ahead-of-Print) articles — the main reason to scan Crossref —
 * are kept inside the recency window.
 */
function publishedFromWork(item: any): Date | null {
  const candidates = [
    item?.["published-online"],
    item?.["published-print"],
    item?.["issued"],
  ];
  let latest: Date | null = null;
  for (const cand of candidates) {
    const parts = cand?.["date-parts"]?.[0];
    if (!Array.isArray(parts)) {
      continue;
    }
    const [y, m, d] = parts;
    const asNum = (x: any): number =>
      x === undefined || x === null ? NaN : Number(x);
    const year = asNum(y);
    if (!Number.isFinite(year) || year < 1990) {
      // Preprint/placeholder years don't help date filtering.
      continue;
    }
    const date = new Date(year, (asNum(m) || 1) - 1, asNum(d) || 1);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }
  return latest;
}

/**
 * Crossref abstracts are JATS XML; strip tags and collapse whitespace.
 */
function cleanAbstract(raw: string): string {
  if (!raw) {
    return "";
  }
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Date string (YYYY-MM-DD) for `days` days ago, timezone-local, as used by
 * the Crossref filter=from-pub-date parameter.
 */
function isoDateDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Non-article works (errata, editorials, book reviews, etc.) returned by
 * Crossref journal queries that should not be evaluated as research papers.
 */
export function isIgnoredWork(type: string, title: string): boolean {
  if (type && type !== "journal-article" && type !== "posted-content") {
    return true;
  }
  const t = title.trim();
  const ignoredPrefixes = [
    /^(author |publisher )?correction\b/i,
    /^errat(um|a)\b/i,
    /^corrigend(um|a)\b/i,
    /^(guest )?editorial\b/i,
    /^editorial board\b/i,
    /^retraction\b/i,
    /^book review\b/i,
    /^(table of contents|toc)\b/i,
    /^issue information\b/i,
    /^(in memoriam|obituary)\b/i,
  ];
  return ignoredPrefixes.some((regex) => regex.test(t));
}
