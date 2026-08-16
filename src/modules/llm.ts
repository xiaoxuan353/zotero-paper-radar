import { resolveChatUrl } from "./config";
import type { RadarConfig } from "./config";

export type ReviewLevel = "high" | "mid" | "low" | "unknown";

export interface ReviewResult {
  level: ReviewLevel;
  text: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/**
 * Ask the configured OpenAI-compatible LLM to grade one paper.
 * Returns null on failure (the paper will be retried on next run,
 * same semantics as the original Python script).
 */
export async function evaluatePaper(
  cfg: RadarConfig,
  title: string,
  abstract: string,
  retries = 4,
): Promise<ReviewResult | null> {
  const prompt = [
    "你是一位学术论文审稿与领域分析专家。",
    "请严格根据以下论文标题与摘要，结合预定义的核心研究方向与分类标准，用中文进行精准研判：",
    "",
    `【核心研究方向】：\n${cfg.direction}`,
    "",
    cfg.criteria,
    "",
    `Title: ${title}`,
    `Abstract: ${abstract}`,
  ].join("\n");

  const body = JSON.stringify({
    model: cfg.model,
    messages: [{ role: "user", content: prompt }],
    temperature: cfg.temperature,
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await Zotero.HTTP.request("POST", cfg.chatUrl, {
        body,
        responseType: "json",
        timeout: 60000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
      });
      const content = (resp.response as any)?.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        return parseReview(content);
      }
      return null;
    } catch (err: any) {
      const status = err?.xhr?.status ?? err?.status ?? 0;
      const retriable = attempt < retries;
      if (status === 429 && retriable) {
        const wait = 2.5 * (attempt + 1) + 0.5 + Math.random();
        ztoolkit.log(`LLM rate-limited (429), backing off ${wait.toFixed(1)}s`);
        await Zotero.Promise.delay(wait * 1000);
        continue;
      }
      if (retriable) {
        await Zotero.Promise.delay(2000);
        continue;
      }
      ztoolkit.log(`LLM evaluation failed: ${err}`);
      return null;
    }
  }
  return null;
}

/**
 * Send a minimal chat request to verify baseUrl + apiKey + model.
 */
export async function testConnection(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<ConnectionTestResult> {
  if (!baseUrl.trim()) {
    return { ok: false, message: "Base URL is empty" };
  }
  if (!apiKey.trim()) {
    return { ok: false, message: "API Key is empty" };
  }
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 16,
    temperature: 0,
  });
  const start = Date.now();
  try {
    const resp = await Zotero.HTTP.request("POST", resolveChatUrl(baseUrl), {
      body,
      responseType: "json",
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const reply = (resp.response as any)?.choices?.[0]?.message?.content;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const snippet = String(reply || "")
      .trim()
      .slice(0, 30);
    return { ok: true, message: `${elapsed}s · ${snippet}` };
  } catch (err: any) {
    ztoolkit.log(`Connection test failed: ${err}`);
    return { ok: false, message: describeHttpError(err) };
  }
}

/**
 * Generate an evaluation-criteria prompt from the user's research
 * direction, keeping the mandatory output-format template intact.
 * Returns null on failure or if the output breaks the format contract.
 */
export async function generateCriteria(
  baseUrl: string,
  apiKey: string,
  model: string,
  direction: string,
): Promise<string | null> {
  const metaPrompt = [
    "你是提示词工程专家。请根据下面的【研究方向】，生成一份用于学术论文相关度评估的【评估要求】提示词。",
    "",
    "生成规则：",
    "1. 严格按以下模板输出：模板中标注 <> 的部分需结合研究方向具体填写；其余文字（第 1 条与第 2 条的固定表述和格式）必须一字不差地保留：",
    "【评估要求】：",
    "1. 第一行必须且只能严格按格式输出：【相关度：高】 或 【相关度：中】 或 【相关度：低】。",
    "   - 【高】：<结合研究方向，写出判定为“直接相关”的具体标准>",
    "   - 【中】：<结合研究方向，写出判定为“方法可借鉴/间接相关”的具体标准>",
    "   - 【低】：<结合研究方向，写出判定为“无关方向”的具体标准>",
    "2. 请用 2 句简明扼要的中文总结该文的研究内容与核心方法。",
    "2. 三档标准要具体、可操作，紧扣研究方向，不要泛泛而谈。",
    "3. 只输出评估要求文本本身，不要输出任何解释、前言、后记或代码块标记。",
    "",
    `【研究方向】：\n${direction}`,
  ].join("\n");

  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: metaPrompt }],
    temperature: 0.3,
  });
  try {
    const resp = await Zotero.HTTP.request("POST", resolveChatUrl(baseUrl), {
      body,
      responseType: "json",
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const content = (resp.response as any)?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return null;
    }
    const cleaned = cleanCriteria(content);
    // The format contract must survive, otherwise review parsing breaks.
    if (!/【相关度：高】/.test(cleaned) || !/【相关度：低】/.test(cleaned)) {
      ztoolkit.log("Generated criteria broke the format contract");
      return null;
    }
    return cleaned;
  } catch (err: any) {
    ztoolkit.log(`Criteria generation failed: ${err}`);
    return null;
  }
}

/**
 * Parse the mandatory first line 【相关度：高/中/低】 out of the review text.
 */
export function parseReview(text: string): ReviewResult {
  const match = text.match(/【相关度[：:]\s*([高中低])】/);
  const levelMap: Record<string, ReviewLevel> = {
    高: "high",
    中: "mid",
    低: "low",
  };
  const level = match ? levelMap[match[1]] || "unknown" : "unknown";
  return { level, text: text.trim() };
}

/**
 * Normalize model output into a criteria block starting with 【评估要求】.
 */
function cleanCriteria(text: string): string {
  let t = text.trim();
  t = t
    .replace(/^```[a-zA-Z]*\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  const idx = t.indexOf("【评估要求】");
  if (idx > 0) {
    t = t.slice(idx);
  } else if (idx < 0) {
    t = `【评估要求】：\n${t}`;
  }
  return t.trim();
}

/**
 * Human-readable one-line description of a Zotero.HTTP error.
 */
function describeHttpError(err: any): string {
  const xhr = err?.xhr;
  const status = xhr?.status ?? err?.status ?? 0;
  let detail = "";
  try {
    const parsed =
      typeof xhr?.responseText === "string"
        ? JSON.parse(xhr.responseText)
        : xhr?.response;
    const msg = parsed?.error?.message || parsed?.message;
    if (msg) {
      detail = `: ${String(msg).slice(0, 120)}`;
    }
  } catch {
    // No structured error body.
  }
  return status ? `HTTP ${status}${detail}` : String(err?.message || err);
}
