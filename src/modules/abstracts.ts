/**
 * Abstract backfill.
 *
 * Why this exists: most publishers do not ship abstracts in their RSS feeds,
 * and Elsevier does not deposit them in Crossref at all:
 *
 * - Wanfang (Chinese journals): full abstract in the feed → nothing to do.
 * - ASCE / SAGE / Wiley: Crossref carries the abstract → nothing to do.
 * - Elsevier (Eng Struct, Structures, TWS, JSV, JCSR, EFA, Comput Struct, ...):
 *   RSS has only volume/authors, Crossref has no abstract, OpenAlex and
 *   Semantic Scholar 404 for weeks after publication, and the article page is
 *   bot-blocked. The only reliable channel is the official Elsevier API.
 * - Taylor & Francis: no abstract anywhere yet; OpenAlex picks it up later.
 *
 * Without an abstract the evaluator can only read the title, which used to
 * push nearly every English paper to "low". This module fills the gap with a
 * chain of providers, cheapest/most reliable first, and remembers what it
 * found so a re-evaluation never pays for the same lookup twice.
 */

const MAX_LOOKUPS_PER_RUN = 400;
const LOOKUP_TIMEOUT_MS = 12000;
const CACHE_FILE_NAME = "paperRadarAbstracts.json";
const CACHE_MAX_ENTRIES = 3000;

export type AbstractSource =
  | "elsevier"
  | "crossref"
  | "openalex"
  | "semanticscholar"
  | "cache"
  | "none";

interface CacheEntry {
  abstract: string;
  fetched: number;
}

/** doi -> entry, loaded lazily from the profile directory. */
let cache: Record<string, CacheEntry> | null = null;
let cacheDirty = false;
let lookupsThisRun = 0;

function cachePath(): string {
  const profileDir = (Zotero as any).getProfileDirectory().path as string;
  const sep = (Zotero as any).isWin ? "\\" : "/";
  return `${profileDir}${sep}${CACHE_FILE_NAME}`;
}

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cache) {
    return cache;
  }
  cache = {};
  try {
    const text = await (Zotero.File as any).getContentsAsync(cachePath());
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      for (const [doi, entry] of Object.entries(parsed as any)) {
        if (entry && typeof (entry as any).abstract === "string") {
          cache[doi] = {
            abstract: String((entry as any).abstract),
            fetched: Number((entry as any).fetched) || 0,
          };
        }
      }
    }
  } catch {
    // No cache yet (or unreadable): start empty.
  }
  return cache;
}

/** Persist the lookup cache (best-effort, capped). */
export async function saveAbstractCache(): Promise<void> {
  if (!cache || !cacheDirty) {
    return;
  }
  try {
    const entries = Object.entries(cache)
      .sort((a, b) => b[1].fetched - a[1].fetched)
      .slice(0, CACHE_MAX_ENTRIES);
    await (Zotero.File as any).putContentsAsync(
      cachePath(),
      JSON.stringify(Object.fromEntries(entries)),
    );
    cacheDirty = false;
  } catch (err) {
    ztoolkit.log(`Failed to save abstract cache: ${err}`);
  }
}

/** Reset the per-run lookup budget (called at the start of every run). */
export function resetAbstractBudget(): void {
  lookupsThisRun = 0;
}

/**
 * Drop the in-memory cache (and the persisted one on the next save).
 * Useful after adding an Elsevier API key: misses recorded while there was no
 * key can then be retried instead of staying empty forever.
 */
export function clearAbstractCache(): void {
  cache = {};
  cacheDirty = true;
}

export interface AbstractLookupResult {
  abstract: string;
  source: AbstractSource;
}

/**
 * Resolve an abstract for one paper.
 *
 * @param doi          DOI of the paper (may be empty: a title lookup is tried)
 * @param title        paper title, used to resolve a DOI when the feed had none
 * @param elsevierKey  optional Elsevier API key (free from dev.elsevier.com)
 */
export async function backfillAbstract(
  doi: string,
  title: string,
  elsevierKey: string,
): Promise<AbstractLookupResult> {
  let cleanDoi = String(doi || "").trim();
  const cleanTitle = String(title || "").trim();
  if (!cleanDoi && !cleanTitle) {
    return { abstract: "", source: "none" };
  }

  const store = await loadCache();
  const cacheKey = cleanDoi || `title:${cleanTitle.toLowerCase()}`;
  const cached = store[cacheKey];
  if (cached) {
    return { abstract: cached.abstract, source: "cache" };
  }
  if (lookupsThisRun >= MAX_LOOKUPS_PER_RUN) {
    return { abstract: "", source: "none" };
  }
  lookupsThisRun++;

  // ScienceDirect's RSS carries only a pii URL, so most feed items reach us
  // without a DOI. Resolve one first, otherwise every provider below has
  // nothing to look up. Chinese titles are skipped: Crossref fuzzy matching
  // returns unrelated records for them (see enrichFromCrossref).
  if (!cleanDoi && cleanTitle && !/[\u4e00-\u9fa5]/.test(cleanTitle)) {
    try {
      cleanDoi = await resolveDoiByTitle(cleanTitle);
    } catch (err) {
      ztoolkit.log(`DOI resolution by title failed: ${err}`);
    }
  }

  const providers: Array<{
    source: AbstractSource;
    run: () => Promise<string>;
  }> = [];

  // Elsevier first: it is the only source for its own journals, and it is
  // authoritative when a key is configured.
  if (cleanDoi) {
    if (elsevierKey && /^10\.1016\//i.test(cleanDoi)) {
      providers.push({
        source: "elsevier",
        run: () => fromElsevier(cleanDoi, elsevierKey),
      });
    }
    providers.push({ source: "crossref", run: () => fromCrossref(cleanDoi) });
    providers.push({ source: "openalex", run: () => fromOpenAlex(cleanDoi) });
    providers.push({
      source: "semanticscholar",
      run: () => fromSemanticScholar(cleanDoi),
    });
  }

  for (const provider of providers) {
    try {
      const text = (await provider.run()).trim();
      if (text.length >= 80) {
        store[cacheKey] = { abstract: text, fetched: Date.now() };
        cacheDirty = true;
        return { abstract: text, source: provider.source };
      }
    } catch (err) {
      ztoolkit.log(`Abstract lookup via ${provider.source} failed: ${err}`);
    }
  }

  // Remember the miss so a re-run does not hammer every provider again.
  store[cacheKey] = { abstract: "", fetched: Date.now() };
  cacheDirty = true;
  return { abstract: "", source: "none" };
}

/* ------------------------------ providers ------------------------------ */

/**
 * Find the DOI of a paper from its title via Crossref, keeping only matches
 * whose title is close enough to avoid attaching a random paper's metadata.
 */
async function resolveDoiByTitle(title: string): Promise<string> {
  const url =
    "https://api.crossref.org/works?query.title=" +
    encodeURIComponent(title) +
    "&rows=1&select=DOI,title&mailto=paper-radar@zotero.plugin";
  const data = await getJson(url);
  const candidate = data?.message?.items?.[0];
  const candidateTitle = Array.isArray(candidate?.title)
    ? String(candidate.title[0] || "")
    : String(candidate?.title || "");
  if (!candidate?.DOI || !isTitleSimilar(title, candidateTitle)) {
    return "";
  }
  return String(candidate.DOI);
}

/** Word-overlap title similarity (same rule as crossref.ts enrichment). */
function isTitleSimilar(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const n1 = normalize(a);
  const n2 = normalize(b);
  if (!n1 || !n2) {
    return false;
  }
  if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) {
    return true;
  }
  const w1 = new Set(n1.split(/\s+/));
  const w2 = new Set(n2.split(/\s+/));
  let intersect = 0;
  for (const word of w1) {
    if (w2.has(word)) {
      intersect++;
    }
  }
  const union = new Set([...w1, ...w2]).size;
  return union > 0 && intersect / union >= 0.6;
}

async function getJson(
  url: string,
  headers?: Record<string, string>,
): Promise<any> {
  const resp = await Zotero.HTTP.request("GET", url, {
    responseType: "json",
    timeout: LOOKUP_TIMEOUT_MS,
    headers: headers || {},
  });
  return (resp as any).response;
}

/** Elsevier ScienceDirect article retrieval (needs a free API key). */
async function fromElsevier(doi: string, apiKey: string): Promise<string> {
  const url =
    "https://api.elsevier.com/content/article/doi/" +
    encodeURIComponent(doi) +
    "?httpAccept=application/json";
  const data = await getJson(url, {
    "X-ELS-APIKey": apiKey,
    Accept: "application/json",
  });
  const core = data?.["full-text-retrieval-response"]?.coredata;
  const raw = core?.["dc:description"];
  if (typeof raw === "string") {
    return stripTags(raw);
  }
  return "";
}

async function fromCrossref(doi: string): Promise<string> {
  const url =
    "https://api.crossref.org/works/" +
    encodeURIComponent(doi) +
    "?mailto=paper-radar@zotero.plugin";
  const data = await getJson(url);
  const raw = data?.message?.abstract;
  return typeof raw === "string" ? stripTags(raw) : "";
}

async function fromOpenAlex(doi: string): Promise<string> {
  const url =
    "https://api.openalex.org/works/doi:" +
    encodeURIComponent(doi) +
    "?mailto=paper-radar@zotero.plugin";
  const data = await getJson(url);
  const inverted = data?.abstract_inverted_index;
  if (!inverted || typeof inverted !== "object") {
    return "";
  }
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inverted as any)) {
    if (!Array.isArray(positions)) {
      continue;
    }
    for (const pos of positions) {
      if (typeof pos === "number") {
        words.push([pos, word]);
      }
    }
  }
  if (words.length === 0) {
    return "";
  }
  return words
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(" ");
}

async function fromSemanticScholar(doi: string): Promise<string> {
  const url =
    "https://api.semanticscholar.org/graph/v1/paper/DOI:" +
    encodeURIComponent(doi) +
    "?fields=abstract";
  const data = await getJson(url);
  const raw = data?.abstract;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Crossref/Elsevier return JATS XML; strip tags and collapse whitespace. */
function stripTags(raw: string): string {
  return String(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-fA-F]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
