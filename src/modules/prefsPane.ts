import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPrefAny, setPrefAny } from "./config";
import { generateCriteria, testConnection } from "./llm";
import { runPipeline } from "./pipeline";

function prefpaneId(key: string): string {
  return `zotero-prefpane-${config.addonRef}-${key}`;
}

function queryEl(win: Window, key: string): any {
  return win.document.getElementById(prefpaneId(key));
}

/**
 * Register the plugin's pane in Zotero's preferences window.
 */
export function registerPrefsPane(): void {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });
}

/**
 * Called when the prefs pane loads: populate controls from preferences
 * and bind change events back. All binding is manual to stay version-safe.
 */
export function registerPrefsScripts(win: Window): void {
  if (!addon.data.prefs) {
    addon.data.prefs = { window: win };
  } else {
    addon.data.prefs.window = win;
  }

  bindText(win, "llm-apikey", "llm.apiKey");
  bindText(win, "llm-baseurl", "llm.baseUrl");
  bindText(win, "llm-model", "llm.model");
  bindNumber(win, "fetch-days", "fetch.daysLimit");
  bindNumber(win, "fetch-workers", "fetch.workers");
  bindText(win, "collection-name", "collection.name");
  bindText(win, "tags-research", "tags.research");
  bindNumber(win, "autorun-interval", "autoRun.intervalHours");
  bindMultiline(win, "feeds-list", "feeds.list");
  bindMultiline(win, "research-direction", "research.direction");
  bindMultiline(win, "research-criteria", "research.criteria");
  bindCheckbox(win, "autorun-enable", "autoRun.enable");

  bindLlmTestButton(win);
  bindCriteriaGenerateButton(win);

  queryEl(win, "run-now")?.addEventListener("click", () => {
    void runPipeline();
  });
}

/**
 * Connection test: reads the three LLM inputs directly from the pane so
 * it works even before the values are committed to preferences.
 */
function bindLlmTestButton(win: Window): void {
  const button = queryEl(win, "llm-test");
  const resultEl = queryEl(win, "llm-test-result");
  if (!button || !resultEl) {
    return;
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    resultEl.style.color = "gray";
    resultEl.textContent = getString("pref-llm-test-waiting");
    const result = await testConnection(
      String(queryEl(win, "llm-baseurl")?.value || ""),
      String(queryEl(win, "llm-apikey")?.value || ""),
      String(queryEl(win, "llm-model")?.value || ""),
    );
    button.disabled = false;
    resultEl.style.color = result.ok ? "green" : "red";
    resultEl.textContent = `${getString(result.ok ? "pref-llm-test-ok" : "pref-llm-test-fail")} ${result.message}`;
  });
}

/**
 * AI-generate the evaluation criteria from the research direction,
 * fill the criteria textarea and save it to preferences.
 */
function bindCriteriaGenerateButton(win: Window): void {
  const button = queryEl(win, "research-generate");
  const resultEl = queryEl(win, "research-generate-result");
  const criteriaEl = queryEl(win, "research-criteria");
  if (!button || !resultEl || !criteriaEl) {
    return;
  }
  button.addEventListener("click", async () => {
    const direction = String(
      queryEl(win, "research-direction")?.value || "",
    ).trim();
    if (!direction) {
      resultEl.style.color = "red";
      resultEl.textContent = getString("pref-research-generate-needdir");
      return;
    }
    button.disabled = true;
    resultEl.style.color = "gray";
    resultEl.textContent = getString("pref-research-generate-waiting");
    const generated = await generateCriteria(
      String(queryEl(win, "llm-baseurl")?.value || ""),
      String(queryEl(win, "llm-apikey")?.value || ""),
      String(queryEl(win, "llm-model")?.value || ""),
      direction,
    );
    button.disabled = false;
    if (generated) {
      criteriaEl.value = generated;
      setPrefAny("research.criteria", generated);
      resultEl.style.color = "green";
      resultEl.textContent = getString("pref-research-generate-ok");
    } else {
      resultEl.style.color = "red";
      resultEl.textContent = getString("pref-research-generate-fail");
    }
  });
}

function bindText(win: Window, id: string, prefKey: string): void {
  const el = queryEl(win, id);
  if (!el) {
    return;
  }
  el.value = String(getPrefAny(prefKey) ?? "");
  el.addEventListener("change", () => setPrefAny(prefKey, el.value));
}

function bindMultiline(win: Window, id: string, prefKey: string): void {
  const el = queryEl(win, id);
  if (!el) {
    return;
  }
  el.value = String(getPrefAny(prefKey) ?? "");
  el.addEventListener("change", () => setPrefAny(prefKey, el.value));
}

function bindNumber(win: Window, id: string, prefKey: string): void {
  const el = queryEl(win, id);
  if (!el) {
    return;
  }
  el.value = String(getPrefAny(prefKey) ?? "");
  el.addEventListener("change", () => {
    const num = Number(el.value);
    if (Number.isFinite(num) && num > 0) {
      setPrefAny(prefKey, num);
    }
  });
}

function bindCheckbox(win: Window, id: string, prefKey: string): void {
  const el = queryEl(win, id);
  if (!el) {
    return;
  }
  el.checked = Boolean(getPrefAny(prefKey));
  // HTML checkbox fires "change"; XUL checkbox fires "command".
  el.addEventListener("change", () => setPrefAny(prefKey, el.checked));
  el.addEventListener("command", () => setPrefAny(prefKey, el.checked));
}
