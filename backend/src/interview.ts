import { z } from "zod";

/** Quick practice offers these session lengths; a session built from an analysis keeps its 3. */
export const QUESTION_COUNTS = [3, 5] as const;
export const MAX_QUESTIONS = 5;
/** Older attempts beyond this are dropped so a row stays small. */
export const MAX_PREVIOUS_ATTEMPTS = 5;

const QUESTION_MIN = 10;
const QUESTION_MAX = 1000;

export const interviewQuestionsSchema = z.array(z.string().trim().min(QUESTION_MIN).max(QUESTION_MAX))
  .min(QUESTION_COUNTS[0]).max(MAX_QUESTIONS);

/** Returns exactly `count` distinct questions of a usable length, or null when the AI gave fewer. */
export function usableQuestions(values: unknown[], count: number): string[] | null {
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const question = value.trim();
    const key = question.toLocaleLowerCase("vi-VN");
    if (question.length < QUESTION_MIN || question.length > QUESTION_MAX || seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
    if (questions.length === count) return questions;
  }
  return null;
}

export function followUpQuestionOf(evaluation: unknown): string | null {
  const value = (evaluation as { follow_up_question?: unknown } | null)?.follow_up_question;
  return typeof value === "string" && value.trim().length >= QUESTION_MIN ? value.trim() : null;
}

export type Attempt = { answer_text: string; evaluation: unknown; follow_up: unknown; created_at: string | null };

export function withPreviousAttempt(previous: unknown, attempt: Attempt): Attempt[] {
  const list = Array.isArray(previous) ? previous as Attempt[] : [];
  return [...list, attempt].slice(-MAX_PREVIOUS_ATTEMPTS);
}

/** The session score averages the main questions only, once every one has an answer. */
export function overallScore(answers: { evaluation: unknown }[], total: number): number | null {
  if (!total || answers.length !== total) return null;
  const sum = answers.reduce((value, answer) =>
    value + Number((answer.evaluation as { score?: number } | null)?.score || 0), 0);
  return Math.round(sum / total);
}
