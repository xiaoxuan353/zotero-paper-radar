import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { runPipeline } from "./pipeline";
import {
  evaluateSelectedItems,
  evaluateSelectedCollection,
  importAndFilterFile,
} from "./batchEvaluator";

const MENU_ID = `${config.addonRef}-menu`;
const RUN_ITEM_ID = `${config.addonRef}-menu-run`;
const IMPORT_ITEM_ID = `${config.addonRef}-menu-import-filter`;
const PREFS_ITEM_ID = `${config.addonRef}-menu-prefs`;

const ITEM_MENU_ID = `${config.addonRef}-itemmenu-eval`;
const COLLECTION_MENU_ID = `${config.addonRef}-collectionmenu-eval`;
const COLLECTION_IMPORT_ID = `${config.addonRef}-collectionmenu-import-filter`;

/**
 * Add "Tools -> Paper Radar" menu and context menus to a window.
 * Plain DOM approach: works the same on Zotero 7/8/9.
 */
export function registerMainMenu(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document as Document & {
    createXULElement: (tag: string) => XUL.Element;
  };

  // 1. Tools -> Paper Radar menu
  const toolsPopup = doc.getElementById("menu_ToolsPopup");
  if (toolsPopup && !doc.getElementById(MENU_ID)) {
    const menu = doc.createXULElement("menu");
    menu.id = MENU_ID;
    menu.setAttribute("label", getString("menu-tools-radar"));

    const popup = doc.createXULElement("menupopup");

    const runItem = doc.createXULElement("menuitem");
    runItem.id = RUN_ITEM_ID;
    runItem.setAttribute("label", getString("menu-tools-runnow"));
    runItem.addEventListener("command", () => {
      void runPipeline();
    });

    const importItem = doc.createXULElement("menuitem");
    importItem.id = IMPORT_ITEM_ID;
    importItem.setAttribute("label", getString("menu-import-filter"));
    importItem.addEventListener("command", () => {
      void importAndFilterFile();
    });

    const prefsItem = doc.createXULElement("menuitem");
    prefsItem.id = PREFS_ITEM_ID;
    prefsItem.setAttribute("label", getString("menu-tools-openprefs"));
    prefsItem.addEventListener("command", () => {
      try {
        (Zotero.Utilities.Internal as any).openPreferences(
          addon.data.config.addonID,
        );
      } catch (err) {
        ztoolkit.log(`Failed to open preferences: ${err}`);
      }
    });

    popup.appendChild(runItem);
    popup.appendChild(importItem);
    popup.appendChild(doc.createXULElement("menuseparator"));
    popup.appendChild(prefsItem);
    menu.appendChild(popup);
    toolsPopup.appendChild(menu);
  }

  // 2. Item Context Menu (right click on items)
  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu && !doc.getElementById(ITEM_MENU_ID)) {
    const itemMenuEntry = doc.createXULElement("menuitem");
    itemMenuEntry.id = ITEM_MENU_ID;
    itemMenuEntry.setAttribute("label", getString("menu-item-batch-eval"));
    itemMenuEntry.addEventListener("command", (event: any) => {
      const forceAll = Boolean(event?.shiftKey);
      void evaluateSelectedItems(forceAll);
    });

    itemMenu.addEventListener("popupshowing", () => {
      const pane = Zotero.getActiveZoteroPane();
      const raw = pane?.getSelectedItems() || [];
      const hasRegular = raw.some((it) => it && it.isRegularItem());
      if (hasRegular) {
        itemMenuEntry.removeAttribute("hidden");
      } else {
        itemMenuEntry.setAttribute("hidden", "true");
      }
    });

    itemMenu.appendChild(itemMenuEntry);
  }

  // 3. Collection Context Menu (right click on collection folder)
  const colMenu = doc.getElementById("zotero-collectionmenu");
  if (colMenu && !doc.getElementById(COLLECTION_MENU_ID)) {
    const colMenuEntry = doc.createXULElement("menuitem");
    colMenuEntry.id = COLLECTION_MENU_ID;
    colMenuEntry.setAttribute("label", getString("menu-collection-batch-eval"));
    colMenuEntry.addEventListener("command", (event: any) => {
      const forceAll = Boolean(event?.shiftKey);
      void evaluateSelectedCollection(forceAll);
    });

    const colImportEntry = doc.createXULElement("menuitem");
    colImportEntry.id = COLLECTION_IMPORT_ID;
    colImportEntry.setAttribute(
      "label",
      getString("menu-collection-import-filter"),
    );
    colImportEntry.addEventListener("command", () => {
      const pane = Zotero.getActiveZoteroPane();
      const col = pane?.getSelectedCollection();
      void importAndFilterFile(col?.key);
    });

    colMenu.addEventListener("popupshowing", () => {
      const pane = Zotero.getActiveZoteroPane();
      const col = pane?.getSelectedCollection();
      if (col) {
        colMenuEntry.removeAttribute("hidden");
        colImportEntry.removeAttribute("hidden");
      } else {
        colMenuEntry.setAttribute("hidden", "true");
        colImportEntry.setAttribute("hidden", "true");
      }
    });

    colMenu.appendChild(colMenuEntry);
    colMenu.appendChild(colImportEntry);
  }
}

export function unregisterMainMenu(): void {
  for (const win of Zotero.getMainWindows()) {
    win.document.getElementById(MENU_ID)?.remove();
    win.document.getElementById(RUN_ITEM_ID)?.remove();
    win.document.getElementById(IMPORT_ITEM_ID)?.remove();
    win.document.getElementById(PREFS_ITEM_ID)?.remove();
    win.document.getElementById(ITEM_MENU_ID)?.remove();
    win.document.getElementById(COLLECTION_MENU_ID)?.remove();
    win.document.getElementById(COLLECTION_IMPORT_ID)?.remove();
  }
}
