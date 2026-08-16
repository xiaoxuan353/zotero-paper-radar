import { config } from "../../package.json";

/**
 * Paper Radar runtime configuration, read from plugin preferences.
 */
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
  researchTag: string;
}

export function getPrefAny(key: string): any {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true);
}

export function setPrefAny(key: string, value: any) {
  return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
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
    researchTag: String(getPrefAny("tags.research") || ""),
  };
}
