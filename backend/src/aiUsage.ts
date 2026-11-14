import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import { config } from "./config";
import { supabase } from "./supabase";

/**
 * Every AI call is recorded with the user and the feature that caused it. The request is kept in
 * async context by a router middleware, so the AI functions need no extra parameters; the user id is
 * read when the call finishes, after requireAuth has set it.
 */
const requestContext = new AsyncLocalStorage<Request & { userId?: string }>();

export function withAiContext(req: Request, _res: unknown, next: () => void): void {
  requestContext.run(req, next);
}

export const AI_FEATURES = {
  analysis: "Phân tích CV–JD",
  cv_structure: "Đọc CV (PDF)",
  cv_quality: "Chấm chất lượng CV",
  cv_rewrite: "AI viết lại CV",
  interview_questions: "Tạo câu hỏi phỏng vấn",
  interview_feedback: "Chấm câu trả lời phỏng vấn",
  speech_to_text: "Giọng nói → chữ",
  text_to_speech: "Đọc câu hỏi (TTS)",
  chat: "Trợ lý chat",
  other: "Khác"
} as const;

export type AiFeature = keyof typeof AI_FEATURES;

/** The feature an API path belongs to (paths as the router sees them, without the /api prefix). */
export function featureOf(method: string, path: string): AiFeature {
  if (path === "/analyze") return "analysis";
  if (/^\/analyses\/[^/]+\/unlock$/.test(path)) return "interview_questions";
  if (path === "/cv/upload") return "cv_structure";
  if (/^\/cv\/[^/]+\/evaluate$/.test(path)) return "cv_quality";
  if (path === "/ai/rewrite-section") return "cv_rewrite";
  if (path === "/interviews" && method === "POST") return "interview_questions";
  if (/^\/interviews\/[^/]+\/transcribe$/.test(path)) return "speech_to_text";
  if (/^\/interviews\/[^/]+\/questions\/[^/]+\/audio$/.test(path)) return "text_to_speech";
  if (/^\/interviews\/[^/]+\/answers/.test(path)) return "interview_feedback";
  if (path === "/chat") return "chat";
  return "other";
}

export type TokenUsage = { input: number; output: number; thought: number; total: number };

/** Token counts from a Gemini interaction result; missing fields count as zero. */
export function tokensOf(result: unknown): TokenUsage {
  const usage = (result as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const read = (key: string) => {
    const value = Number(usage[key]);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  };
  const input = read("total_input_tokens");
  const output = read("total_output_tokens");
  const thought = read("total_thought_tokens");
  return { input, output, thought, total: read("total_tokens") || input + output + thought };
}

export type Pricing = { inputUsdPerM: number; outputUsdPerM: number; usdVnd: number };

export function currentPricing(): Pricing {
  return {
    inputUsdPerM: config.AI_PRICE_INPUT_USD_PER_M,
    outputUsdPerM: config.AI_PRICE_OUTPUT_USD_PER_M,
    usdVnd: config.USD_VND_RATE
  };
}

/** Estimated cost in VND. Thinking tokens are billed at the output price. */
export function estimateCostVnd(tokens: { input: number; output: number; thought: number }, pricing: Pricing): number {
  const usd = (tokens.input * pricing.inputUsdPerM + (tokens.output + tokens.thought) * pricing.outputUsdPerM) / 1_000_000;
  return usd * pricing.usdVnd;
}

let tableMissingWarned = false;

/** Fire-and-forget: a failed usage write is logged and never fails the user's request. */
export function recordAiUsage(entry: { model: string; result?: unknown; startedAt: number; success: boolean }): void {
  const req = requestContext.getStore();
  const tokens = tokensOf(entry.result);
  const row = {
    user_id: req?.userId ?? null,
    feature: req ? featureOf(req.method, req.path) : "other",
    model: entry.model,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    thought_tokens: tokens.thought,
    total_tokens: tokens.total,
    latency_ms: Math.max(0, Date.now() - entry.startedAt),
    success: entry.success
  };
  void Promise.resolve(supabase.from("ai_usage").insert(row)).then(({ error }) => {
    if (!error) return;
    if (error.code === "PGRST205" || /ai_usage/.test(error.message ?? "")) {
      if (!tableMissingWarned) console.warn("AI usage is not recorded: apply supabase/migrations/011_admin_analytics.sql");
      tableMissingWarned = true;
      return;
    }
    console.error("Could not record AI usage", error.message);
  }, (error: unknown) => console.error("Could not record AI usage", error));
}
