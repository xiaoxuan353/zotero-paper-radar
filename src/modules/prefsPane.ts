import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPrefAny, setPrefAny } from "./config";
import { generateCriteria, testConnection } from "./llm";
import { probeJournalIssn } from "./crossref";
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
  bindText(win, "feeds-list", "feeds.list");
  bindText(win, "journals-list", "feed.journals");
  bindText(win, "research-direction", "research.direction");
  bindText(win, "research-criteria", "research.criteria");
  bindCheckbox(win, "autorun-enable", "autoRun.enable");
  bindCheckbox(win, "crossref-enable", "feed.crossrefEnable");
  bindNumber(win, "crossref-rows", "feed.crossrefRows");
  bindHelp(
    win,
    "feeds-help",
    "https://github.com/xiaoxuan353/zotero-paper-radar#rss",
  );
  bindHelp(
    win,
    "journals-help",
    "https://github.com/xiaoxuan353/zotero-paper-radar#crossref",
  );

  bindLlmTestButton(win);
  bindCriteriaGenerateButton(win);
  bindCrossrefTestButton(win);

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
 * Probe every journal currently typed in the Crossref list (from the textarea
 * directly, so unsaved edits count) and report which ISSNs are invalid.
 */
function bindCrossrefTestButton(win: Window): void {
  const button = queryEl(win, "journals-test");
  const resultEl = queryEl(win, "journals-test-result");
  if (!button || !resultEl) {
    return;
  }
  button.addEventListener("click", async () => {
    const text = String(queryEl(win, "journals-list")?.value || "");
    const lines = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      resultEl.style.color = "red";
      resultEl.textContent = getString("pref-crossref-test-empty");
      return;
    }
    button.disabled = true;
    resultEl.style.color = "gray";
    resultEl.textContent = getString("pref-crossref-test-waiting");
    try {
      // Probe with low concurrency: Crossref rate-limits unauthenticated
      // bursts (429). Sequential-ish probing keeps valid journals from being
      // misreported as invalid. Each probe also retries transient 429/5xx.
      let cursor = 0;
      const results: Awaited<ReturnType<typeof probeJournalIssn>>[] = [];
      const concurrency = 2;
      const workers = Array.from(
        { length: Math.min(concurrency, lines.length) },
        async () => {
          while (cursor < lines.length) {
            const line = lines[cursor++];
            const [issn, ...rest] = line.split("|");
            const name = rest.join("|").trim() || issn;
            results.push(
              await probeJournalIssn(String(issn || "").trim(), name),
            );
          }
        },
      );
      await Promise.all(workers);
      const failed = results.filter((r) => !r.ok);
      resultEl.style.color = failed.length === 0 ? "green" : "red";
      if (failed.length === 0) {
        resultEl.textContent = getString("pref-crossref-test-ok", {
          args: { ok: results.length },
        });
      } else {
        const summary = failed
          .map((f) => `${f.name}（${f.message}）`)
          .join("；");
        resultEl.textContent = getString("pref-crossref-test-fail", {
          args: { count: failed.length, names: summary },
        });
      }
    } catch (err) {
      resultEl.style.color = "red";
      resultEl.textContent = getString("pref-crossref-test-fail", {
        args: { count: 1, names: String(err) },
      });
    } finally {
      button.disabled = false;
    }
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

/**
 * Bind a help link to open an external help page (README section) in the
 * default browser. Uses Zotero.launchURL which is available on 6/7/8/9.
 */
function bindHelp(win: Window, id: string, url: string): void {
  const link = queryEl(win, id);
  if (!link) {
    return;
  }
  link.addEventListener("click", (e: Event) => {
    e.preventDefault();
    try {
      Zotero.launchURL(url);
    } catch (err) {
      // Fallback for older Zotero where launchURL is not exposed.
      win.alert(String(err));
    }
  });
}
