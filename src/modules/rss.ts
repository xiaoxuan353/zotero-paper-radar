const ATOM_NS = "http://www.w3.org/2005/Atom";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (mailto:paper-radar@zotero.plugin)",
};

export interface FeedEntry {
  title: string;
  abstract: string;
  url: string;
  published: Date | null;
  doi: string;
  feedUrl: string;
  /** Author full names as found in the feed, best-effort. */
  authors: string[];
  /** Journal title extracted from feed channel metadata. */
  journalTitle?: string;
}

/**
 * Strip common Chinese online-first / pre-publication prefixes
 * (e.g. 【网络首发】, [优先出版], etc.) for consistent deduplication.
 */
export function cleanTitlePrefix(title: string): string {
  return (title || "")
    .replace(/^[【[(（](网络首发|优先出版|最新录用|首发)[】\])）]\s*/i, "")
    .trim();
}

/**
 * Global unique paper id: DOI > normalized title > URL,
 * same strategy as the original Python script.
 */
export function makePaperId(entry: FeedEntry): string {
  if (entry.doi) {
    return `doi:${entry.doi}`;
  }
  const title = cleanTitlePrefix(entry.title).toLowerCase();
  if (title) {
    return `title:${title}`;
  }
  return `url:${entry.url}`;
}

export function withinDays(entry: FeedEntry, days: number): boolean {
  // Papers without a parseable date are kept to avoid missing new issues.
  if (!entry.published) {
    return true;
  }
  return Date.now() - entry.published.getTime() <= days * 86400_000;
}

export async function fetchFeed(feedUrl: string): Promise<FeedEntry[]> {
  const attempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await Zotero.HTTP.request("GET", feedUrl, {
        responseType: "text",
        timeout: 20000,
        headers: BROWSER_HEADERS,
      });
      return parseFeed(resp.responseText || "", feedUrl);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        await Zotero.Promise.delay(1500 * attempt);
      }
    }
  }
  throw lastErr;
}

/**
 * Parse RSS 2.0 (Wanfang/ScienceDirect/...) or Atom (ASCE/T&F/...) feeds
 * into a normalized entry list.
 */
function parseFeed(xmlText: string, feedUrl: string): FeedEntry[] {
  let doc: XMLDocument;
  try {
    doc = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch {
    return [];
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return [];
  }

  let nodes = Array.from(doc.getElementsByTagName("item")) as Element[];
  const isAtom = nodes.length === 0;
  if (isAtom) {
    nodes = Array.from(
      doc.getElementsByTagNameNS(ATOM_NS, "entry"),
    ) as Element[];
  }

  let journalTitle = "";
  const root = doc.documentElement;
  if (root) {
    if (isAtom) {
      journalTitle = cleanText(childText(root, "title", ATOM_NS));
    } else {
      const channel = doc.getElementsByTagName("channel")[0] || root;
      journalTitle = cleanText(childText(channel, "title"));
    }
  }

  const entries: FeedEntry[] = [];
  for (const node of nodes) {
    const title = cleanText(childText(node, "title"));
    if (!title) {
      continue;
    }
    let abstract = "";
    let url = "";
    let dateStr = "";
    let authors: string[] = [];
    if (isAtom) {
      abstract = cleanText(
        childText(node, "summary", ATOM_NS) ||
          childText(node, "content", ATOM_NS),
      );
      const linkEl = node.getElementsByTagNameNS(ATOM_NS, "link")[0];
      url = linkEl?.getAttribute("href") || "";
      dateStr =
        childText(node, "published", ATOM_NS) ||
        childText(node, "updated", ATOM_NS);
      authors = parseAtomAuthors(node);
    } else {
      abstract = cleanText(
        childText(node, "description") || childText(node, "description", DC_NS),
      );
      url = childText(node, "link") || childText(node, "guid");
      dateStr = childText(node, "pubDate") || childText(node, "date", DC_NS);
      authors = parseRssAuthors(node);
    }
    const published = parseDate(dateStr);
    const doiMatch = `${title}\n${abstract}\n${url}`.match(DOI_RE);
    entries.push({
      title,
      abstract,
      url,
      published,
      doi: doiMatch ? sanitizeDoi(doiMatch[0]) : "",
      feedUrl,
      authors,
      journalTitle,
    });
  }
  return entries;
}

function childText(parent: Element, tag: string, ns?: string): string {
  const el = ns
    ? parent.getElementsByTagNameNS(ns, tag)[0]
    : parent.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() || "";
}

function childTexts(parent: Element, tag: string, ns?: string): string[] {
  const els: Element[] = ns
    ? Array.from(parent.getElementsByTagNameNS(ns, tag) as any)
    : Array.from(parent.getElementsByTagName(tag));
  return els.map((el) => el?.textContent?.trim() || "").filter(Boolean);
}

function parseAtomAuthors(node: Element): string[] {
  const names = childTexts(node, "name", ATOM_NS);
  const out: string[] = [];
  for (const n of names) {
    out.push(...splitAuthors(n));
  }
  return out;
}

function parseRssAuthors(node: Element): string[] {
  // dc:creator usually holds full names, one per element.
  const dc = childTexts(node, "creator", DC_NS);
  const authors: string[] = [];
  for (const c of dc) {
    authors.push(...splitAuthors(c));
  }
  // RSS 2.0 <author> is "email (Display Name)" or plain author strings separated by 、 / ;
  for (const a of childTexts(node, "author")) {
    const m = a.match(/\(([^)]+)\)/);
    const text = m ? m[1].trim() : a.trim();
    authors.push(...splitAuthors(text));
  }
  return dedupe(authors);
}

/**
 * Split a field that may contain several authors separated by `;`, `；`, or `、`
 * (Chinese enumeration comma).
 * We deliberately do NOT split on half-width commas `,`, because western names use the
 * "Family, Given" convention and would be broken apart.
 */
function splitAuthors(raw: string): string[] {
  return raw
    .split(/[;；、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Strip HTML tags and resolve entities via a throwaway HTML document.
 */
function cleanText(raw: string): string {
  if (!raw) {
    return "";
  }
  try {
    const doc = new DOMParser().parseFromString(
      `<div>${raw}</div>`,
      "text/html",
    );
    return (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
  } catch {
    return raw.replace(/\s+/g, " ").trim();
  }
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) {
    return null;
  }
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sanitizeDoi(doi: string): string {
  return doi.replace(/[.;)\]]+$/, "");
}

export interface FeedProbeResult {
  url: string;
  title: string;
  ok: boolean;
  count: number;
  latestDate?: string;
  message: string;
}

/**
 * Probe whether an RSS / Atom feed URL is accessible and parseable.
 */
export async function probeFeed(feedUrl: string): Promise<FeedProbeResult> {
  try {
    const resp = await Zotero.HTTP.request("GET", feedUrl, {
      responseType: "text",
      timeout: 15000,
      headers: BROWSER_HEADERS,
    });
    const text = resp.responseText || "";
    const entries = parseFeed(text, feedUrl);
    if (entries.length === 0) {
      return {
        url: feedUrl,
        title: feedUrl,
        ok: false,
        count: 0,
        message: "未能解析到文章（XML 为空或非有效 RSS/Atom 格式）",
      };
    }
    const journalTitle = entries[0]?.journalTitle || feedUrl;
    const latest = entries[0]?.published;
    const dateStr = latest
      ? `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, "0")}-${String(latest.getDate()).padStart(2, "0")}`
      : "无发布日期";
    return {
      url: feedUrl,
      title: journalTitle,
      ok: true,
      count: entries.length,
      latestDate: dateStr,
      message: `${journalTitle}（${entries.length} 篇，最新：${dateStr}）`,
    };
  } catch (err: any) {
    const status = err?.xhr?.status ?? err?.status ?? 0;
    const reason = status ? `HTTP ${status}` : String(err?.message || err);
    return {
      url: feedUrl,
      title: feedUrl,
      ok: false,
      count: 0,
      message: `${feedUrl}（${reason}）`,
    };
  }
}
