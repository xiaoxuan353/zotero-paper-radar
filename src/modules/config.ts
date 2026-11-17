import { config } from "../../package.json";

export const DEFAULT_FEEDS_LIST =
  "https://apps.wanfangdata.com.cn/perios/rss/gclx\nhttps://apps.wanfangdata.com.cn/perios/rss/gljtkj\nhttps://apps.wanfangdata.com.cn/perios/rss/gwql\nhttps://apps.wanfangdata.com.cn/perios/rss/tmgcxb\nhttps://apps.wanfangdata.com.cn/perios/rss/zdycj\nhttps://apps.wanfangdata.com.cn/perios/rss/zgglxb\nhttps://apps.wanfangdata.com.cn/perios/rss/zgtdkx\nhttps://apps.wanfangdata.com.cn/perios/rss/tdxb\nhttps://apps.wanfangdata.com.cn/perios/rss/zdgcxb\nhttps://apps.wanfangdata.com.cn/perios/rss/jzjgxb\nhttps://zgglxb.chd.edu.cn/CN/rss_zxly.xml\nhttps://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jbenf2\nhttps://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jsendh\nhttps://rss.sciencedirect.com/publication/science/01410296\nhttps://rss.sciencedirect.com/publication/science/23520124\nhttps://rss.sciencedirect.com/publication/science/02638231\nhttps://rss.sciencedirect.com/publication/science/0022460X\nhttps://www.tandfonline.com/feed/rss/nsie20";

export const DEFAULT_JOURNALS_LIST =
  "1545-2263|Structural Control and Health Monitoring\n1084-0702|ASCE Journal of Bridge Engineering\n0733-9445|ASCE Journal of Structural Engineering\n0141-0296|Engineering Structures\n2352-0124|Structures\n0263-8231|Thin-Walled Structures\n0022-460X|Journal of Sound and Vibration\n1573-2479|Structure and Infrastructure Engineering\n0887-3828|ASCE J. Performance of Constructed Facilities\n2190-5452|J. Civil Structural Health Monitoring\n1569-8025|Structural Health Monitoring (SAGE)\n0143-974X|J. Constructional Steel Research\n1350-6307|Engineering Failure Analysis\n0167-4730|Structural Safety\n0098-8847|Earthquake Engineering & Structural Dynamics\n1570-761X|Bulletin of Earthquake Engineering\n0045-7949|Computers & Structures\n1369-4332|Advances in Structural Engineering";

/**
 * Paper Radar runtime configuration, read from plugin preferences.
 */
export interface JournalSpec {
  issn: string;
  name: string;
}

export interface LLMProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface RadarConfig {
  profileName?: string;
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
  /** Optional Elsevier API key (dev.elsevier.com). Elsevier journals ship no
   *  abstract in RSS and none in Crossref, so this is the only way to give the
   *  evaluator real text for Eng Struct / Structures / TWS / JSV / JCSR / EFA. */
  elsevierApiKey: string;
  /** Whether Crossref-by-ISSN scanning is enabled. */
  crossrefEnable: boolean;
  /** Journals to scan via Crossref, each with ISSN and display name. */
  crossrefJournals: JournalSpec[];
  /** Number of recent works pulled per journal before date filtering. */
  crossrefRows: number;
  /** Skip saving an item that still has neither creators nor a DOI after
   *  Crossref enrichment (prevents incomplete duplicate orphans). When true,
   *  such items are deferred and retried on the next run instead of saved. */
  strictMetadata: boolean;
  /** When a source returns items but none fall inside the recency window
   *  (typical for "最新录用 / online first" feeds that carry stale dates),
   *  take its newest N items once instead of dropping the source silently. */
  staleFallback: boolean;
  /** How many newest items a stale source may contribute per run. */
  staleFallbackLimit: number;
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

export function getLLMProfiles(): LLMProfile[] {
  const raw = getPrefAny("llm.profiles");
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // NOTE: no legacy migration here. It used to run on every read, which
        // meant adding a new model (whose settings are mirrored to the legacy
        // prefs) silently overwrote the first profile that had no API key —
        // e.g. a local Ollama profile. Migration is now a one-time step in the
        // no-profiles branch below.
        return parsed.map((p, idx) => ({
          id: String(p.id || `profile_${idx}`),
          name: String(p.name || "新建模型"),
          baseUrl: String(p.baseUrl || ""),
          apiKey: String(p.apiKey || ""),
          model: String(p.model || ""),
        }));
      }
    } catch {
      // JSON parse error: fall through to the legacy build below.
    }
  }

  // No usable profiles stored yet: build one from the legacy single-model
  // preferences (llm.baseUrl / llm.apiKey / llm.model) and persist it.
  const initialProfiles: LLMProfile[] = [
    {
      id: "default",
      name: "默认模型",
      baseUrl: String(
        getPrefAny("llm.baseUrl") ||
          "https://ark.cn-beijing.volces.com/api/coding/v3",
      ),
      apiKey: String(getPrefAny("llm.apiKey") || ""),
      model: String(getPrefAny("llm.model") || "deepseek-v4-flash"),
    },
  ];
  saveLLMProfiles(initialProfiles);
  setActiveProfileId("default");
  return initialProfiles;
}

export function saveLLMProfiles(profiles: LLMProfile[]): void {
  setPrefAny("llm.profiles", JSON.stringify(profiles));
}

export function getActiveProfileId(): string {
  const activeId = String(getPrefAny("llm.activeProfileId") || "");
  const profiles = getLLMProfiles();
  if (profiles.some((p) => p.id === activeId)) {
    return activeId;
  }
  return profiles[0]?.id || "default";
}

export function setActiveProfileId(id: string): void {
  setPrefAny("llm.activeProfileId", id);
}

export function getActiveLLMProfile(): LLMProfile {
  const profiles = getLLMProfiles();
  const activeId = String(getPrefAny("llm.activeProfileId") || "");
  const found = profiles.find((p) => p.id === activeId) || profiles[0];
  return (
    found || {
      id: "default",
      name: "默认模型",
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      apiKey: "",
      model: "deepseek-v4-flash",
    }
  );
}

export function getConfig(): RadarConfig {
  const feeds = String(getPrefAny("feeds.list") || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const activeProfile = getActiveLLMProfile();
  const baseUrl = activeProfile.baseUrl;
  return {
    profileName: activeProfile.name,
    baseUrl,
    chatUrl: resolveChatUrl(baseUrl),
    apiKey: activeProfile.apiKey,
    model: activeProfile.model,
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
    elsevierApiKey: String(getPrefAny("abstracts.elsevierApiKey") || "").trim(),
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
    strictMetadata: getPrefAny("fetch.strictMetadata") !== false,
    staleFallback: getPrefAny("fetch.staleFallback") !== false,
    staleFallbackLimit: Math.max(
      1,
      Math.min(50, Number(getPrefAny("fetch.staleFallbackLimit")) || 10),
    ),
  };
}

/**
 * Fingerprint of everything that changes how a paper is judged: the model, the
 * research direction and the evaluation criteria. Stored alongside the
 * processed records so that editing the criteria (or switching model) triggers
 * a re-evaluation instead of silently keeping verdicts made under the old
 * rules — previously a "low" verdict was final for 90 days no matter what.
 */
export function computeCriteriaFingerprint(cfg: {
  direction: string;
  criteria: string;
  model: string;
}): string {
  const raw = `${cfg.model}\u0000${cfg.direction}\u0000${cfg.criteria}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function getDedupFingerprint(): string {
  return String(getPrefAny("dedup.fingerprint") || "");
}

export function setDedupFingerprint(value: string): void {
  setPrefAny("dedup.fingerprint", value);
}
