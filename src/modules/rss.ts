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
}

/**
 * Global unique paper id: DOI > normalized title > URL,
 * same strategy as the original Python script.
 */
export function makePaperId(entry: FeedEntry): string {
  if (entry.doi) {
    return `doi:${entry.doi}`;
  }
  const title = entry.title.trim().toLowerCase();
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
  const resp = await Zotero.HTTP.request("GET", feedUrl, {
    responseType: "text",
    timeout: 20000,
    headers: BROWSER_HEADERS,
  });
  return parseFeed(resp.responseText || "", feedUrl);
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

  const entries: FeedEntry[] = [];
  for (const node of nodes) {
    const title = cleanText(childText(node, "title"));
    if (!title) {
      continue;
    }
    let abstract = "";
    let url = "";
    let dateStr = "";
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
    } else {
      abstract = cleanText(
        childText(node, "description") || childText(node, "description", DC_NS),
      );
      url = childText(node, "link") || childText(node, "guid");
      dateStr = childText(node, "pubDate") || childText(node, "date", DC_NS);
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
