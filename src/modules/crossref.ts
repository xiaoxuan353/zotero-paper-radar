export interface EnrichedMeta {
  DOI?: string;
  publicationTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  date?: string;
}

/**
 * Fill missing metadata (journal, volume, issue, pages, date) from Crossref.
 * Failures are non-fatal: the item is saved with whatever is known.
 */
export async function enrichFromCrossref(
  title: string,
  doi: string,
): Promise<EnrichedMeta> {
  const url = doi
    ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    : `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=1`;
  try {
    const resp = await Zotero.HTTP.request("GET", url, {
      responseType: "json",
      timeout: 10000,
    });
    let msg = (resp.response as any)?.message;
    if (Array.isArray(msg?.items) && msg.items.length > 0) {
      msg = msg.items[0];
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
    mailto: "paper-radar@zotero.plugin",
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
  const url = `${CROSSREF_BASE}/${encodeURIComponent(issn)}`;
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
