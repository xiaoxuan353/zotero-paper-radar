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
