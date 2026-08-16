import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { runPipeline } from "./pipeline";

const MENU_ID = `${config.addonRef}-menu`;
const RUN_ITEM_ID = `${config.addonRef}-menu-run`;
const PREFS_ITEM_ID = `${config.addonRef}-menu-prefs`;

/**
 * Add "Tools -> Paper Radar" menu with run/settings entries to a window.
 * Plain DOM approach: works the same on Zotero 7/8/9.
 */
export function registerMainMenu(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document as Document & {
    createXULElement: (tag: string) => XUL.Element;
  };
  const toolsPopup = doc.getElementById("menu_ToolsPopup");
  if (!toolsPopup || doc.getElementById(MENU_ID)) {
    return;
  }

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
  popup.appendChild(doc.createXULElement("menuseparator"));
  popup.appendChild(prefsItem);
  menu.appendChild(popup);
  toolsPopup.appendChild(menu);
}

export function unregisterMainMenu(): void {
  for (const win of Zotero.getMainWindows()) {
    win.document.getElementById(MENU_ID)?.remove();
  }
}
