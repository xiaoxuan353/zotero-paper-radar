import { getConfig } from "./config";
import { evaluatePaper } from "./llm";
import { getString } from "../utils/locale";
import { getOrCreateCollection, parseCreators } from "./writer";
import { cleanTitlePrefix } from "./rss";

declare const Components: any;

let evaluating = false;

export function isBatchEvaluating(): boolean {
  return evaluating;
}

/**
 * Trigger batch evaluation for currently selected items in the main window.
 */
export async function evaluateSelectedItems(forceAll = false): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  const rawItems = (pane?.getSelectedItems() || []) as Zotero.Item[];
  const items = rawItems.filter((it) => it && it.isRegularItem());
  await runBatchEvaluation(items, forceAll);
}

/**
 * Trigger batch evaluation for all items in the currently selected collection.
 */
export async function evaluateSelectedCollection(
  forceAll = false,
): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  const col = pane?.getSelectedCollection();
  if (!col) {
    showPopup(getString("progress-batch-no-items"), "fail");
    return;
  }
  const itemIDs = col.getChildItems(true);
  const rawItems = (await Zotero.Items.getAsync(itemIDs)) as Zotero.Item[];
  const items = (rawItems || []).filter((it) => it && it.isRegularItem());
  await runBatchEvaluation(items, forceAll);
}

/**
 * Core batch evaluation runner for items already in Zotero.
 */
export async function runBatchEvaluation(
  items: Zotero.Item[],
  forceAll = false,
): Promise<void> {
  if (evaluating) {
    showPopup(getString("progress-running"), "fail");
    return;
  }
  if (!items.length) {
    showPopup(getString("progress-batch-no-items"), "fail");
    return;
  }
  const cfg = getConfig();
  if (!cfg.apiKey) {
    showPopup(getString("progress-nokey"), "fail");
    return;
  }

  evaluating = true;
  const progress = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  });

  try {
    const targets: Zotero.Item[] = [];
    let skipped = 0;
    for (const item of items) {
      const title = String(item.getField("title") || "").trim();
      // Skip search-engine / CNKI portal webpage snapshots
      if (
        item.itemType === "webpage" &&
        (!item.getField("abstractNote") || /知网|检索|search/i.test(title))
      ) {
        ztoolkit.log(`Skipping search page snapshot: ${title}`);
        continue;
      }
      if (
        !forceAll &&
        (item.hasTag("相关度：高") ||
          item.hasTag("相关度：中") ||
          item.hasTag("相关度：低"))
      ) {
        skipped++;
      } else {
        targets.push(item);
      }
    }

    if (!targets.length) {
      progress
        .createLine({
          text: getString("progress-batch-all-evaluated", {
            args: { count: skipped },
          }),
          progress: 100,
        })
        .show();
      progress.startCloseTimer(6000);
      return;
    }

    progress
      .createLine({
        text: getString("progress-batch-start", {
          args: { total: targets.length, skipped },
        }),
        progress: 0,
      })
      .show();

    // Prepare target collections for journals and theses
    const journalCol = cfg.collectionName
      ? await getOrCreateCollection(cfg.collectionName)
      : null;
    const thesisCol = cfg.collectionThesisName
      ? await getOrCreateCollection(cfg.collectionThesisName)
      : null;

    let done = 0;
    let high = 0;
    let mid = 0;
    let low = 0;

    await runWithPool(targets, cfg.workers, async (item) => {
      const title = String(item.getField("title") || "").trim();
      const abstract = String(item.getField("abstractNote") || "").trim();
      const review = await evaluatePaper(cfg, title, abstract);
      done++;

      if (
        review &&
        (review.level === "high" ||
          review.level === "mid" ||
          review.level === "low")
      ) {
        item.removeTag("相关度：高");
        item.removeTag("相关度：中");
        item.removeTag("相关度：低");

        const isThesis = item.itemType === "thesis";

        if (review.level === "high") {
          high++;
          item.addTag("相关度：高");
          item.addTag("AI精选");
          if (cfg.researchTag) {
            item.addTag(cfg.researchTag);
          }
        } else if (review.level === "mid") {
          mid++;
          item.addTag("相关度：中");
          item.addTag("AI精选");
          if (cfg.researchTag) {
            item.addTag(cfg.researchTag);
          }
        } else {
          low++;
          item.addTag("相关度：低");
          item.removeTag("AI精选");
        }

        // Tag thesis metadata and categorize into the dedicated collection
        if (review.level === "high" || review.level === "mid") {
          if (isThesis) {
            item.addTag("学位论文");
            try {
              const thesisType = String(
                item.getField("thesisType" as any) || "",
              );
              if (/博士|doctor/i.test(thesisType)) {
                item.addTag("博士论文");
              } else if (/硕士|master/i.test(thesisType)) {
                item.addTag("硕士论文");
              }
            } catch {
              // ignore
            }

            if (thesisCol) {
              item.addToCollection(thesisCol.id);
            }
          } else if (journalCol) {
            item.addToCollection(journalCol.id);
          }
        }

        await item.saveTx();

        // Update or create AI Review child note
        await saveOrUpdateAiNote(item, review.text);
      }

      progress.changeLine({
        text: getString("progress-batch-evaluating", {
          args: {
            done,
            total: targets.length,
            title: title.slice(0, 35),
          },
        }),
        progress: Math.round((done / targets.length) * 100),
      });
    });

    progress.changeLine({
      text: getString("progress-batch-done", {
        args: {
          done,
          high,
          mid,
          low,
          skipped,
        },
      }),
      progress: 100,
    });
    progress.startCloseTimer(8000);
  } catch (err) {
    ztoolkit.log(`Batch evaluation error: ${err}`);
    try {
      progress.changeLine({ text: String(err), type: "fail" });
      progress.startCloseTimer(6000);
    } catch {
      // ignore
    }
  } finally {
    evaluating = false;
  }
}

/**
 * Candidate bibliographic record parsed from .ris / .enw before entering Zotero.
 */
export interface CandidatePaper {
  itemType: "thesis" | "journalArticle";
  title: string;
  authors: string[];
  abstract: string;
  year?: string;
  university?: string;
  thesisType?: string;
  advisor?: string;
  doi?: string;
  url?: string;
}

/**
 * Parse an EndNote (.enw), RefMan (.ris), BibTeX (.bib), or Refworks file content in memory.
 */
export function parseBibliographicText(text: string): CandidatePaper[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (clean.includes("%0 ")) {
    return parseEnwText(clean);
  }
  if (clean.includes("TY  - ")) {
    return parseRisText(clean);
  }
  if (
    /@(article|phdthesis|mastersthesis|thesis|inproceedings|techreport|book|misc)\s*\{/i.test(
      clean,
    )
  ) {
    return parseBibTexText(clean);
  }
  if (/^RT\s+/m.test(clean)) {
    return parseRefworksText(clean);
  }
  // Fallbacks:
  if (clean.includes("@") && clean.includes("{")) {
    const bib = parseBibTexText(clean);
    if (bib.length > 0) return bib;
  }
  if (clean.includes("A1 ") && clean.includes("T1 ")) {
    const rw = parseRefworksText(clean);
    if (rw.length > 0) return rw;
  }
  return parseEnwText(clean);
}

function parseEnwText(text: string): CandidatePaper[] {
  const papers: CandidatePaper[] = [];
  const lines = text.split("\n");
  let current: Partial<CandidatePaper> | null = null;
  let currentTag = "";

  const commit = () => {
    if (current && current.title) {
      papers.push({
        itemType: current.itemType || "journalArticle",
        title: current.title,
        authors: current.authors || [],
        abstract: current.abstract || "",
        year: current.year,
        university: current.university,
        thesisType: current.thesisType,
        advisor: current.advisor,
        doi: current.doi,
        url: current.url,
      });
    }
    current = null;
    currentTag = "";
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^%[A-Za-z0-9]\s/.test(line)) {
      const tag = line.slice(0, 2);
      const val = line.slice(3).trim();
      currentTag = tag;

      if (tag === "%0") {
        commit();
        current = {
          itemType: /thesis/i.test(val) ? "thesis" : "journalArticle",
          authors: [],
          abstract: "",
        };
      } else if (current) {
        if (tag === "%T") {
          current.title = val;
        } else if (tag === "%A") {
          if (!current.authors) current.authors = [];
          current.authors.push(val);
        } else if (tag === "%Y") {
          current.advisor = val;
        } else if (tag === "%I") {
          current.university = val;
        } else if (tag === "%9") {
          current.thesisType = val;
          if (/硕士|博士|thesis|dissertation/i.test(val)) {
            current.itemType = "thesis";
          }
        } else if (tag === "%D") {
          current.year = val;
        } else if (tag === "%X") {
          current.abstract = val;
        } else if (tag === "%R") {
          current.doi = val;
        } else if (tag === "%U") {
          current.url = val;
        }
      }
    } else if (current && currentTag === "%X") {
      current.abstract =
        (current.abstract ? current.abstract + "\n" : "") + trimmed;
    }
  }
  commit();
  return papers;
}

function parseRisText(text: string): CandidatePaper[] {
  const papers: CandidatePaper[] = [];
  const lines = text.split("\n");
  let current: Partial<CandidatePaper> | null = null;
  let currentTag = "";

  const commit = () => {
    if (current && current.title) {
      papers.push({
        itemType: current.itemType || "journalArticle",
        title: current.title,
        authors: current.authors || [],
        abstract: current.abstract || "",
        year: current.year,
        university: current.university,
        thesisType: current.thesisType,
        advisor: current.advisor,
        doi: current.doi,
        url: current.url,
      });
    }
    current = null;
    currentTag = "";
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^[A-Z0-9]{2}\s{2}-\s/.test(line)) {
      const tag = line.slice(0, 2);
      const val = line.slice(6).trim();
      currentTag = tag;

      if (tag === "TY") {
        commit();
        current = {
          itemType: /THES/i.test(val) ? "thesis" : "journalArticle",
          authors: [],
          abstract: "",
        };
      } else if (tag === "ER") {
        commit();
      } else if (current) {
        if (tag === "TI" || tag === "T1") {
          current.title = val;
        } else if (tag === "AU" || tag === "A1") {
          if (!current.authors) current.authors = [];
          current.authors.push(val);
        } else if (tag === "A2" || tag === "ED") {
          current.advisor = val;
        } else if (tag === "PB") {
          current.university = val;
        } else if (tag === "M3") {
          current.thesisType = val;
          if (/硕士|博士|thesis|dissertation/i.test(val)) {
            current.itemType = "thesis";
          }
        } else if (tag === "PY" || tag === "Y1") {
          current.year = val.slice(0, 4);
        } else if (tag === "AB" || tag === "N2") {
          current.abstract = val;
        } else if (tag === "DO") {
          current.doi = val;
        } else if (tag === "UR") {
          current.url = val;
        }
      }
    } else if (current && (currentTag === "AB" || currentTag === "N2")) {
      current.abstract =
        (current.abstract ? current.abstract + "\n" : "") + trimmed;
    }
  }
  commit();
  return papers;
}

function parseBibTexFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    while (i < body.length && (/\s/.test(body[i]) || body[i] === ",")) {
      i++;
    }
    if (i >= body.length) break;

    const keyStart = i;
    while (i < body.length && /[a-zA-Z0-9_-]/.test(body[i])) {
      i++;
    }
    const key = body.slice(keyStart, i).toLowerCase();
    if (!key) {
      i++;
      continue;
    }

    while (i < body.length && body[i] !== "=") {
      i++;
    }
    if (i >= body.length) break;
    i++; // skip '='

    while (i < body.length && /\s/.test(body[i])) {
      i++;
    }
    if (i >= body.length) break;

    let value = "";
    if (body[i] === "{") {
      i++;
      let depth = 1;
      const valStart = i;
      while (i < body.length && depth > 0) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}") depth--;
        i++;
      }
      value = body.slice(valStart, depth === 0 ? i - 1 : i);
    } else if (body[i] === '"') {
      i++;
      const valStart = i;
      while (i < body.length && body[i] !== '"') {
        if (body[i] === "\\" && i + 1 < body.length) i++;
        i++;
      }
      value = body.slice(valStart, i);
      if (i < body.length && body[i] === '"') i++;
    } else {
      const valStart = i;
      while (
        i < body.length &&
        body[i] !== "," &&
        body[i] !== "\n" &&
        body[i] !== "}"
      ) {
        i++;
      }
      value = body.slice(valStart, i).trim();
    }

    fields[key] = value.trim();
  }
  return fields;
}

function parseBibTexText(text: string): CandidatePaper[] {
  const papers: CandidatePaper[] = [];
  const entryRegex =
    /@([a-zA-Z]+)\s*\{\s*([^,]*),([\s\S]*?)(?=\s*@[a-zA-Z]+\s*\{|\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(text)) !== null) {
    const rawType = match[1].toLowerCase();
    const body = match[3];

    const isThesisType =
      rawType === "phdthesis" ||
      rawType === "mastersthesis" ||
      rawType === "thesis";
    let itemType: "thesis" | "journalArticle" = isThesisType
      ? "thesis"
      : "journalArticle";

    const fields = parseBibTexFields(body);

    const title = (fields["title"] || "").replace(/[{}]/g, "").trim();
    if (!title) continue;

    const abstract = (fields["abstract"] || fields["abstractnote"] || "")
      .replace(/[{}]/g, "")
      .trim();

    const rawAuthor = fields["author"] || "";
    const authors = rawAuthor
      ? rawAuthor
          .split(/\s+and\s+/i)
          .map((a) => a.replace(/[{}]/g, "").trim())
          .filter(Boolean)
      : [];

    const year =
      fields["year"] ||
      (fields["date"] ? fields["date"].slice(0, 4) : undefined);
    const university =
      fields["school"] || fields["institution"] || fields["university"];
    const thesisType =
      fields["type"] ||
      (rawType === "phdthesis"
        ? "博士学位论文"
        : rawType === "mastersthesis"
          ? "硕士学位论文"
          : undefined);

    if (thesisType && /硕士|博士|thesis|dissertation/i.test(thesisType)) {
      itemType = "thesis";
    }

    papers.push({
      itemType,
      title,
      authors,
      abstract,
      year,
      university,
      thesisType,
      doi: fields["doi"],
      url: fields["url"],
    });
  }
  return papers;
}

function parseRefworksText(text: string): CandidatePaper[] {
  const papers: CandidatePaper[] = [];
  const lines = text.split("\n");
  let current: Partial<CandidatePaper> | null = null;
  let currentTag = "";

  const commit = () => {
    if (current && current.title) {
      papers.push({
        itemType: current.itemType || "journalArticle",
        title: current.title,
        authors: current.authors || [],
        abstract: current.abstract || "",
        year: current.year,
        university: current.university,
        thesisType: current.thesisType,
        advisor: current.advisor,
        doi: current.doi,
        url: current.url,
      });
    }
    current = null;
    currentTag = "";
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === "ER" || /^ER(\s.*)?$/.test(trimmed)) {
      commit();
      continue;
    }

    if (/^[A-Z0-9]{2}\s/.test(line)) {
      const tag = line.slice(0, 2);
      const val = line.slice(3).trim();
      currentTag = tag;

      if (tag === "RT") {
        commit();
        const isThesis = /thesis|dissertation|学位|博士|硕士/i.test(val);
        current = {
          itemType: isThesis ? "thesis" : "journalArticle",
          authors: [],
          abstract: "",
          thesisType: isThesis ? val : undefined,
        };
      } else if (current) {
        if (tag === "T1" || tag === "TI") {
          current.title = val;
        } else if (tag === "A1" || tag === "AU") {
          if (!current.authors) current.authors = [];
          current.authors.push(val);
        } else if (tag === "A2" || tag === "ED") {
          current.advisor = val;
        } else if (tag === "PB" || tag === "OP" || tag === "AD") {
          current.university = val;
        } else if (tag === "YR" || tag === "FD") {
          current.year = val.slice(0, 4);
        } else if (tag === "AB") {
          current.abstract = val;
        } else if (tag === "DO") {
          current.doi = val;
        } else if (tag === "LK" || tag === "UL") {
          current.url = val;
        }
      }
    } else if (current && currentTag === "AB") {
      current.abstract =
        (current.abstract ? current.abstract + "\n" : "") + trimmed;
    }
  }
  commit();
  return papers;
}

/**
 * Open native OS file picker to select a .ris / .enw / .bib file.
 */
async function pickBibliographicFile(): Promise<string | null> {
  try {
    const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(
      Components.interfaces.nsIFilePicker,
    );
    const win = Zotero.getMainWindow();
    fp.init(
      win,
      getString("filepicker-title") || "Select Bibliographic File",
      Components.interfaces.nsIFilePicker.modeOpen,
    );
    fp.appendFilter(
      "Bibliographic Files (*.enw, *.ris, *.bib, *.txt)",
      "*.enw; *.ris; *.bib; *.txt",
    );
    fp.appendFilters(Components.interfaces.nsIFilePicker.filterAll);

    const res = await new Promise<number>((resolve) => {
      fp.open((result: number) => resolve(result));
    });

    if (res === Components.interfaces.nsIFilePicker.returnOK && fp.file) {
      return fp.file.path;
    }
    return null;
  } catch (err) {
    ztoolkit.log(`FilePicker error: ${err}`);
    return null;
  }
}

/**
 * Feature: Import & AI Filter File (.ris / .enw).
 * Pre-screens papers in memory, and ONLY saves High/Mid papers into Zotero!
 * Low-relevance papers are discarded in memory, keeping Zotero 100% clean.
 */
export async function importAndFilterFile(
  targetCollectionKey?: string,
): Promise<void> {
  if (evaluating) {
    showPopup(getString("progress-running"), "fail");
    return;
  }

  const filePath = await pickBibliographicFile();
  if (!filePath) {
    return;
  }

  let text = "";
  try {
    text = (await Zotero.File.getContentsAsync(filePath)) as string;
  } catch (err) {
    showPopup(`Failed to read file: ${err}`, "fail");
    return;
  }

  if (!text || !text.trim()) {
    showPopup(getString("progress-import-filter-empty"), "fail");
    return;
  }

  const candidates = parseBibliographicText(text);
  if (!candidates.length) {
    showPopup(getString("progress-import-filter-empty"), "fail");
    return;
  }

  const cfg = getConfig();
  if (!cfg.apiKey) {
    showPopup(getString("progress-nokey"), "fail");
    return;
  }

  evaluating = true;
  const progress = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  });

  try {
    progress
      .createLine({
        text: getString("progress-import-filter-start", {
          args: { total: candidates.length },
        }),
        progress: 0,
      })
      .show();

    const journalCol = cfg.collectionName
      ? await getOrCreateCollection(cfg.collectionName)
      : null;
    const thesisCol = cfg.collectionThesisName
      ? await getOrCreateCollection(cfg.collectionThesisName)
      : null;

    let done = 0;
    let saved = 0;
    let high = 0;
    let mid = 0;
    let discarded = 0;

    await runWithPool(candidates, cfg.workers, async (paper) => {
      const review = await evaluatePaper(cfg, paper.title, paper.abstract);
      done++;

      if (review && (review.level === "high" || review.level === "mid")) {
        // QUALIFIED PAPER: Save into Zotero!
        try {
          const libId = Zotero.Libraries.userLibraryID;
          const item = new Zotero.Item(paper.itemType);
          item.libraryID = libId;
          const cleanTitle = cleanTitlePrefix(paper.title);
          item.setField("title", cleanTitle || paper.title);

          const creators = parseCreators(paper.authors);
          if (creators.length > 0) {
            item.setCreators(creators);
          }
          if (paper.abstract) {
            item.setField("abstractNote", paper.abstract);
          }
          if (paper.year) {
            item.setField("date", paper.year);
          }
          if (paper.doi) {
            item.setField("DOI", paper.doi);
          }
          if (paper.url) {
            item.setField("url", paper.url);
          }

          const isThesis = paper.itemType === "thesis";
          if (isThesis) {
            if (paper.university) {
              try {
                item.setField("university" as any, paper.university);
              } catch {
                // ignore
              }
            }
            if (paper.thesisType) {
              try {
                item.setField("thesisType" as any, paper.thesisType);
              } catch {
                // ignore
              }
            }
          }

          // Tags
          item.addTag("AI精选");
          if (cfg.researchTag) {
            item.addTag(cfg.researchTag);
          }
          item.addTag(review.level === "high" ? "相关度：高" : "相关度：中");

          if (isThesis) {
            item.addTag("学位论文");
            if (/博士|doctor/i.test(paper.thesisType || "")) {
              item.addTag("博士论文");
            } else if (/硕士|master/i.test(paper.thesisType || "")) {
              item.addTag("硕士论文");
            }
          }

          if (targetCollectionKey) {
            item.setCollections([targetCollectionKey]);
          } else if (isThesis && thesisCol) {
            item.setCollections([thesisCol.key]);
          } else if (!isThesis && journalCol) {
            item.setCollections([journalCol.key]);
          }

          const saveResult = await item.saveTx();
          if (typeof saveResult === "number") {
            // Create child note
            await saveOrUpdateAiNote(item, review.text);

            saved++;
            if (review.level === "high") {
              high++;
            } else {
              mid++;
            }
          }
        } catch (saveErr) {
          ztoolkit.log(`Failed to save pre-screened paper: ${saveErr}`);
        }
      } else {
        // UNQUALIFIED OR LOW: Discard directly in memory! ZERO pollution!
        discarded++;
      }

      progress.changeLine({
        text: getString("progress-import-filter-evaluating", {
          args: {
            done,
            total: candidates.length,
            title: paper.title.slice(0, 35),
          },
        }),
        progress: Math.round((done / candidates.length) * 100),
      });
    });

    progress.changeLine({
      text: getString("progress-import-filter-done", {
        args: {
          saved,
          high,
          mid,
          discarded,
        },
      }),
      progress: 100,
    });
    progress.startCloseTimer(8000);
  } catch (err) {
    ztoolkit.log(`Import and filter error: ${err}`);
    try {
      progress.changeLine({ text: String(err), type: "fail" });
      progress.startCloseTimer(6000);
    } catch {
      // ignore
    }
  } finally {
    evaluating = false;
  }
}

async function saveOrUpdateAiNote(
  item: Zotero.Item,
  reviewText: string,
): Promise<void> {
  try {
    const noteContent = `<h3>AI 研判解读</h3><p>${escapeHtml(reviewText).replace(/\n/g, "<br>")}</p>`;
    const noteIDs = item.getNotes();
    if (noteIDs && noteIDs.length > 0) {
      const notes = (await Zotero.Items.getAsync(noteIDs)) as Zotero.Item[];
      const existingNote = notes.find((n) =>
        String(n.getNote() || "").includes("AI 研判解读"),
      );
      if (existingNote) {
        existingNote.setNote(noteContent);
        await existingNote.saveTx();
        return;
      }
    }
    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
    note.parentID = item.id;
    note.setNote(noteContent);
    await note.saveTx();
  } catch (err) {
    ztoolkit.log(`Failed to save AI note for item ${item.id}: ${err}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showPopup(text: string, type: "fail" | "default" = "default") {
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({ text, type, progress: 100 })
    .show()
    .startCloseTimer(5000);
}

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
