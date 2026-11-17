import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  DEFAULT_FEEDS_LIST,
  DEFAULT_JOURNALS_LIST,
  getActiveProfileId,
  getLLMProfiles,
  getPrefAny,
  saveLLMProfiles,
  setActiveProfileId,
  setPrefAny,
} from "./config";
import type { LLMProfile } from "./config";
import { generateCriteria, testConnection } from "./llm";
import { probeJournalIssn } from "./crossref";
import { probeFeed } from "./rss";
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

  // The pane's root element fires onload every time the pane is shown. When the
  // same markup is reused, binding again would attach a second copy of every
  // handler: one click on 新增 would create two profiles, and a stale closure
  // would write form values into a different profile than the one on screen.
  // A fresh pane (new markup) has no marker, so it still binds normally.
  const rootEl = queryEl(win, "root");
  if (rootEl && (rootEl as any).__paperRadarPrefsBound) {
    return;
  }
  if (rootEl) {
    (rootEl as any).__paperRadarPrefsBound = true;
  }

  bindLLMProfiles(win);
  bindNumber(win, "fetch-days", "fetch.daysLimit");
  bindNumber(win, "fetch-workers", "fetch.workers");
  bindText(win, "collection-name", "collection.name");
  bindText(win, "collection-thesis-name", "collection.thesisName");
  bindText(win, "tags-research", "tags.research");
  bindNumber(win, "autorun-interval", "autoRun.intervalDays");
  bindText(win, "feeds-list", "feeds.list");
  bindText(win, "journals-list", "feed.journals");
  bindText(win, "research-direction", "research.direction");
  bindText(win, "research-criteria", "research.criteria");
  bindText(win, "elsevier-apikey", "abstracts.elsevierApiKey");
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
  bindFeedsManagement(win);
  bindFeedsTestButton(win);
  bindCriteriaGenerateButton(win);
  bindCrossrefManagement(win);
  bindCrossrefTestButton(win);

  queryEl(win, "run-now")?.addEventListener("click", () => {
    void runPipeline();
  });
}

/**
 * Bind LLM profiles management: select active model, add/delete profile,
 * and edit profile details. Selected model is the active model.
 */
function bindLLMProfiles(win: Window): void {
  const rawSelectEl = queryEl(
    win,
    "llm-profile-select",
  ) as HTMLSelectElement | null;
  if (!rawSelectEl) {
    return;
  }
  const selectEl: HTMLSelectElement = rawSelectEl;
  const detailsEl = queryEl(win, "llm-details") as HTMLDetailsElement | null;
  const badgeEl = queryEl(win, "llm-summary-badge") as HTMLElement | null;
  const nameEl = queryEl(win, "llm-profile-name") as HTMLInputElement | null;
  const urlEl = queryEl(win, "llm-baseurl") as HTMLInputElement | null;
  const keyEl = queryEl(win, "llm-apikey") as HTMLInputElement | null;
  const modelEl = queryEl(win, "llm-model") as HTMLInputElement | null;
  const addBtn = queryEl(win, "llm-profile-add") as HTMLButtonElement | null;
  const deleteBtn = queryEl(
    win,
    "llm-profile-delete",
  ) as HTMLButtonElement | null;
  const resultEl = queryEl(win, "llm-test-result");

  let profiles = getLLMProfiles();
  let activeId = getActiveProfileId();

  /**
   * Re-read the stored profiles. Every mutation starts from the persisted
   * state instead of a snapshot taken when the pane was bound, so two open
   * preference windows (or a run in the background) can never make one of them
   * save a stale array that silently drops another profile.
   */
  function reloadProfiles(): void {
    profiles = getLLMProfiles();
    if (!profiles.some((p) => p.id === activeId)) {
      activeId = profiles[0]?.id || "default";
    }
  }

  function persistProfiles(): void {
    saveLLMProfiles(profiles);
  }

  /**
   * The profile currently shown in the form. Never falls back to an unrelated
   * profile for writing: a stale active id is healed first, otherwise typing
   * into the form would overwrite a different model's settings.
   */
  function getCurrentProfile(): LLMProfile {
    const found = profiles.find((p) => p.id === activeId);
    if (found) {
      return found;
    }
    activeId = profiles[0]?.id || "default";
    setActiveProfileId(activeId);
    return profiles[0];
  }

  /** "新建模型" / "新建模型 2" / "新建模型 3" ... */
  function uniqueProfileName(base: string): string {
    const taken = new Set(profiles.map((p) => p.name));
    if (!taken.has(base)) {
      return base;
    }
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base} ${i}`;
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    return `${base} ${Date.now()}`;
  }

  /**
   * Ids must be unique even when two clicks land in the same millisecond,
   * otherwise both profiles would share an id and edits would land on the
   * wrong one.
   */
  function uniqueProfileId(): string {
    const taken = new Set(profiles.map((p) => p.id));
    const base = `profile_${Date.now()}`;
    if (!taken.has(base)) {
      return base;
    }
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}_${i}`;
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    return `${base}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function syncActiveToPrefs(profile: LLMProfile): void {
    setPrefAny("llm.baseUrl", profile.baseUrl);
    setPrefAny("llm.apiKey", profile.apiKey);
    setPrefAny("llm.model", profile.model);
  }

  function updateSummaryBadge(): void {
    if (!badgeEl) {
      return;
    }
    const current = getCurrentProfile();
    const isExpanded = Boolean(detailsEl?.open);
    const actionText = isExpanded
      ? getString("pref-llm-action-collapse")
      : getString("pref-llm-action-expand");
    badgeEl.textContent = getString("pref-llm-summary-badge", {
      args: { name: current.name, action: actionText },
    });
  }

  function updateInputFields(profile: LLMProfile): void {
    if (nameEl) {
      nameEl.value = profile.name;
    }
    if (urlEl) {
      urlEl.value = profile.baseUrl;
    }
    if (keyEl) {
      keyEl.value = profile.apiKey;
    }
    if (modelEl) {
      modelEl.value = profile.model;
    }
    if (resultEl) {
      resultEl.textContent = "";
    }
  }

  function renderSelectOptions(): void {
    selectEl.innerHTML = "";
    for (const p of profiles) {
      const opt = win.document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "option",
      ) as HTMLOptionElement;
      opt.value = p.id;
      opt.textContent = p.name || p.model || p.id;
      selectEl.appendChild(opt);
    }
    selectEl.value = activeId;
  }

  renderSelectOptions();
  const current = getCurrentProfile();
  activeId = current.id;
  updateInputFields(current);
  syncActiveToPrefs(current);
  updateSummaryBadge();

  detailsEl?.addEventListener("toggle", updateSummaryBadge);

  selectEl.addEventListener("change", () => {
    reloadProfiles();
    activeId = selectEl.value;
    setActiveProfileId(activeId);
    const p = getCurrentProfile();
    updateInputFields(p);
    syncActiveToPrefs(p);
    updateSummaryBadge();
  });

  const onFieldChange = (): void => {
    reloadProfiles();
    const p = getCurrentProfile();
    if (nameEl) {
      p.name = nameEl.value;
      const opt = selectEl.querySelector(`option[value="${p.id}"]`);
      if (opt) {
        opt.textContent =
          p.name || getString("pref-llm-profile-new-default-name");
      }
    }
    if (urlEl) {
      p.baseUrl = urlEl.value.trim();
    }
    if (keyEl) {
      p.apiKey = keyEl.value.trim();
    }
    if (modelEl) {
      p.model = modelEl.value.trim();
    }

    persistProfiles();
    syncActiveToPrefs(p);
    updateSummaryBadge();
  };

  nameEl?.addEventListener("input", onFieldChange);
  nameEl?.addEventListener("change", onFieldChange);
  urlEl?.addEventListener("input", onFieldChange);
  urlEl?.addEventListener("change", onFieldChange);
  keyEl?.addEventListener("input", onFieldChange);
  keyEl?.addEventListener("change", onFieldChange);
  modelEl?.addEventListener("input", onFieldChange);
  modelEl?.addEventListener("change", onFieldChange);

  addBtn?.addEventListener("click", () => {
    reloadProfiles();
    const newId = uniqueProfileId();
    const newProfile: LLMProfile = {
      id: newId,
      name: uniqueProfileName(getString("pref-llm-profile-new-default-name")),
      baseUrl: "",
      apiKey: "",
      model: "",
    };
    profiles.push(newProfile);
    activeId = newId;
    persistProfiles();
    setActiveProfileId(activeId);
    syncActiveToPrefs(newProfile);

    renderSelectOptions();
    updateInputFields(newProfile);
    updateSummaryBadge();

    nameEl?.focus();
    nameEl?.select();
  });

  deleteBtn?.addEventListener("click", () => {
    reloadProfiles();
    if (profiles.length <= 1) {
      win.alert(getString("pref-llm-profile-delete-last-warn"));
      return;
    }
    const toDelete = getCurrentProfile();
    const confirmMsg = getString("pref-llm-profile-delete-confirm", {
      args: { name: toDelete.name },
    });
    if (!win.confirm(confirmMsg || `确定要删除模型「${toDelete.name}」吗？`)) {
      return;
    }

    const removedIndex = profiles.findIndex((p) => p.id === toDelete.id);
    profiles = profiles.filter((p) => p.id !== toDelete.id);
    // Keep the user near where they were instead of always jumping to the top.
    const nextIndex = Math.min(Math.max(removedIndex, 0), profiles.length - 1);
    activeId = profiles[nextIndex].id;
    persistProfiles();
    setActiveProfileId(activeId);

    const next = getCurrentProfile();
    syncActiveToPrefs(next);
    renderSelectOptions();
    updateInputFields(next);
    updateSummaryBadge();
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
 * Probe every RSS feed URL currently typed in the feeds list.
 */
function bindFeedsTestButton(win: Window): void {
  const button = queryEl(win, "feeds-test");
  const resultEl = queryEl(win, "feeds-test-result");
  if (!button || !resultEl) {
    return;
  }
  button.addEventListener("click", async () => {
    const text = String(queryEl(win, "feeds-list")?.value || "");
    const lines = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      resultEl.style.color = "red";
      resultEl.textContent = getString("pref-feeds-test-empty");
      return;
    }
    button.disabled = true;
    resultEl.style.color = "gray";
    resultEl.textContent = getString("pref-feeds-test-waiting");
    try {
      const results: Awaited<ReturnType<typeof probeFeed>>[] = [];
      const validUrls: string[] = [];
      for (const line of lines) {
        if (/^https?:\/\//i.test(line)) {
          validUrls.push(line);
        } else {
          results.push({
            url: line,
            title: line,
            ok: false,
            count: 0,
            message: `${line}（URL 格式无效，必须以 http:// 或 https:// 开头）`,
          });
        }
      }
      let cursor = 0;
      const concurrency = 3;
      const workers = Array.from(
        { length: Math.min(concurrency, validUrls.length) },
        async () => {
          while (cursor < validUrls.length) {
            const url = validUrls[cursor++];
            results.push(await probeFeed(url));
          }
        },
      );
      await Promise.all(workers);
      const failed = results.filter((r) => !r.ok);
      resultEl.style.color = failed.length === 0 ? "green" : "red";
      if (failed.length === 0) {
        resultEl.textContent = getString("pref-feeds-test-ok", {
          args: { ok: results.length },
        });
      } else {
        const summary = failed.map((f) => f.message).join("；");
        resultEl.textContent = getString("pref-feeds-test-fail", {
          args: { count: failed.length, names: summary },
        });
      }
    } catch (err) {
      resultEl.style.color = "red";
      resultEl.textContent = getString("pref-feeds-test-fail", {
        args: { count: 1, names: String(err) },
      });
    } finally {
      button.disabled = false;
    }
  });
}

/**
 * Bind RSS feeds management: live count badge and reset to defaults.
 */
function bindFeedsManagement(win: Window): void {
  const textarea = queryEl(win, "feeds-list") as HTMLTextAreaElement | null;
  const badge = queryEl(win, "feeds-count-badge") as HTMLElement | null;
  const resetBtn = queryEl(win, "feeds-reset") as HTMLButtonElement | null;

  function updateBadge(): void {
    if (!badge || !textarea) return;
    const count = textarea.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean).length;
    badge.textContent = getString("pref-feeds-count-badge", {
      args: { count },
    });
  }

  updateBadge();
  textarea?.addEventListener("input", updateBadge);
  textarea?.addEventListener("change", updateBadge);

  resetBtn?.addEventListener("click", () => {
    if (win.confirm(getString("pref-feeds-reset-confirm"))) {
      if (textarea) {
        textarea.value = DEFAULT_FEEDS_LIST;
      }
      setPrefAny("feeds.list", DEFAULT_FEEDS_LIST);
      updateBadge();
    }
  });
}

/**
 * Bind Crossref journals management: live count badge and reset to defaults.
 */
function bindCrossrefManagement(win: Window): void {
  const textarea = queryEl(win, "journals-list") as HTMLTextAreaElement | null;
  const badge = queryEl(win, "crossref-count-badge") as HTMLElement | null;
  const resetBtn = queryEl(win, "journals-reset") as HTMLButtonElement | null;

  function updateBadge(): void {
    if (!badge || !textarea) return;
    const count = textarea.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean).length;
    badge.textContent = getString("pref-crossref-count-badge", {
      args: { count },
    });
  }

  updateBadge();
  textarea?.addEventListener("input", updateBadge);
  textarea?.addEventListener("change", updateBadge);

  resetBtn?.addEventListener("click", () => {
    if (win.confirm(getString("pref-crossref-reset-confirm"))) {
      if (textarea) {
        textarea.value = DEFAULT_JOURNALS_LIST;
      }
      setPrefAny("feed.journals", DEFAULT_JOURNALS_LIST);
      updateBadge();
    }
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
            resultEl.textContent = getString("pref-crossref-test-progress", {
              args: { done: results.length, total: lines.length },
            });
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
