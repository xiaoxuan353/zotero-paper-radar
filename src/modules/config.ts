import { config } from "../../package.json";

/**
 * Paper Radar runtime configuration, read from plugin preferences.
 */
export interface JournalSpec {
  issn: string;
  name: string;
}

export interface RadarConfig {
  baseUrl: string;
  /** Full chat-completions URL resolved from baseUrl. */
  chatUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  direction: string;
  criteria: string;
  feeds: string[];
  daysLimit: number;
  workers: number;
  collectionName: string;
  collectionThesisName: string;
  researchTag: string;
  /** Whether Crossref-by-ISSN scanning is enabled. */
  crossrefEnable: boolean;
  /** Journals to scan via Crossref, each with ISSN and display name. */
  crossrefJournals: JournalSpec[];
  /** Number of recent works pulled per journal before date filtering. */
  crossrefRows: number;
}

export function getPrefAny(key: string): any {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true);
}

export function setPrefAny(key: string, value: any) {
  try {
    return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
  } catch {
    try {
      Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true);
      return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
    } catch {
      // ignore
    }
  }
}

export function getLastRun(): number {
  const val = getPrefAny("autoRun.lastRun");
  const num = Number(val);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function setLastRun(time: number = Date.now()): void {
  const fullKey = `${config.prefsPrefix}.autoRun.lastRun`;
  try {
    const current = Zotero.Prefs.get(fullKey, true);
    if (typeof current === "number") {
      Zotero.Prefs.clear(fullKey, true);
    }
  } catch {
    // ignore
  }
  setPrefAny("autoRun.lastRun", String(time));
}

/**
 * Resolve the full chat-completions URL from a base URL.
 *
 * The user fills in everything before "/chat/completions", e.g.
 * - Volcano Ark Coding Plan: https://ark.cn-beijing.volces.com/api/coding/v3
 * - Volcano Ark pay-per-use: https://ark.cn-beijing.volces.com/api/v3
 * - OpenAI:                  https://api.openai.com/v1
 * - DeepSeek:                https://api.deepseek.com/v1
 *
 * A full URL ending with /chat/completions is accepted as-is.
 */
export function resolveChatUrl(baseUrl: string): string {
  const url = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!url) {
    return "";
  }
  return /\/chat\/completions$/.test(url) ? url : `${url}/chat/completions`;
}

export function getConfig(): RadarConfig {
  const feeds = String(getPrefAny("feeds.list") || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const baseUrl = String(getPrefAny("llm.baseUrl") || "");
  return {
    baseUrl,
    chatUrl: resolveChatUrl(baseUrl),
    apiKey: String(getPrefAny("llm.apiKey") || ""),
    model: String(getPrefAny("llm.model") || ""),
    temperature: Number(getPrefAny("llm.temperature")) || 0.2,
    direction: String(getPrefAny("research.direction") || ""),
    criteria: String(getPrefAny("research.criteria") || ""),
    feeds,
    daysLimit: Math.max(1, Number(getPrefAny("fetch.daysLimit")) || 9),
    workers: Math.min(
      10,
      Math.max(1, Number(getPrefAny("fetch.workers")) || 6),
    ),
    collectionName: String(getPrefAny("collection.name") || "AI精选前沿论文"),
    collectionThesisName: String(
      getPrefAny("collection.thesisName") || "AI精选学位论文",
    ),
    researchTag: String(getPrefAny("tags.research") || ""),
    crossrefEnable: Boolean(getPrefAny("feed.crossrefEnable")),
    crossrefRows: Math.max(
      1,
      Math.min(1000, Number(getPrefAny("feed.crossrefRows")) || 200),
    ),
    crossrefJournals: String(getPrefAny("feed.journals") || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [issn, ...rest] = line.split("|");
        return {
          issn: String(issn || "").trim(),
          name: rest.join("|").trim() || issn,
        };
      })
      .filter((j) => /^\d{4}-?\d{3}[\dXx]$/.test(j.issn)),
  };
}
