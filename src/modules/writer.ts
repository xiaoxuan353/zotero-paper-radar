import type { EnrichedMeta } from "./crossref";
import type { FeedEntry } from "./rss";
import type { ReviewLevel } from "./llm";

/**
 * Find (or create) the top-level target collection by name.
 */
export async function getOrCreateCollection(
  name: string,
): Promise<Zotero.Collection | null> {
  try {
    const libId = Zotero.Libraries.userLibraryID;
    const cols = Zotero.Collections.getByLibrary(libId) as Zotero.Collection[];
    const found = cols.find((col) => col.name === name);
    if (found) {
      return found;
    }
    const col = new Zotero.Collection();
    col.name = name;
    await col.saveTx();
    return col;
  } catch (err) {
    ztoolkit.log(`Failed to get/create collection: ${err}`);
    return null;
  }
}

/**
 * Check whether an item with the same DOI (or exact title) already
 * exists in the user library, to avoid duplicates beyond feed-level dedup.
 */
export async function existsInLibrary(
  doi: string,
  title: string,
): Promise<boolean> {
  try {
    const s = new Zotero.Search();
    s.addCondition("libraryID", "is", String(Zotero.Libraries.userLibraryID));
    if (doi) {
      s.addCondition("DOI", "is", doi);
    } else if (title) {
      s.addCondition("title", "is", title);
    } else {
      return false;
    }
    const ids = await s.search();
    return ids.length > 0;
  } catch (err) {
    ztoolkit.log(`Library duplicate check failed: ${err}`);
    return false;
  }
}

/**
 * Create the journalArticle item with tags and the "AI 研判解读"
 * child note. Returns the saved item, or null on failure.
 */
export async function savePaper(
  entry: FeedEntry,
  meta: EnrichedMeta,
  reviewText: string,
  level: ReviewLevel,
  collectionKey: string,
  researchTag: string,
): Promise<Zotero.Item | null> {
  try {
    const libId = Zotero.Libraries.userLibraryID;
    const item = new Zotero.Item("journalArticle");
    item.libraryID = libId;
    item.setField("title", entry.title);
    if (entry.abstract) {
      item.setField("abstractNote", entry.abstract);
    }
    if (entry.url) {
      item.setField("url", entry.url);
    }
    const doi = meta.DOI || entry.doi;
    if (doi) {
      item.setField("DOI", doi);
    }
    if (meta.publicationTitle) {
      item.setField("publicationTitle", meta.publicationTitle);
    }
    if (meta.volume) {
      item.setField("volume", meta.volume);
    }
    if (meta.issue) {
      item.setField("issue", meta.issue);
    }
    if (meta.pages) {
      item.setField("pages", meta.pages);
    }
    if (meta.date) {
      item.setField("date", meta.date);
    }
    if (collectionKey) {
      item.setCollections([collectionKey]);
    }
    item.addTag("AI精选");
    if (researchTag) {
      item.addTag(researchTag);
    }
    item.addTag(level === "high" ? "相关度：高" : "相关度：中");
    const saveResult = await item.saveTx();
    if (typeof saveResult !== "number") {
      ztoolkit.log(`Item save returned no id: ${entry.title}`);
      return null;
    }

    const note = new Zotero.Item("note");
    note.libraryID = libId;
    note.parentID = saveResult;
    note.setNote(
      `<h3>AI 研判解读</h3><p>${escapeHtml(reviewText).replace(/\n/g, "<br>")}</p>`,
    );
    await note.saveTx();
    return item;
  } catch (err) {
    ztoolkit.log(`Failed to save paper "${entry.title}": ${err}`);
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
