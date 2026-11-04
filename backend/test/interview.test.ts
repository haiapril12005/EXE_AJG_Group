import assert from "node:assert/strict";
import test from "node:test";
import { LruCache } from "../src/cache";
import { followUpQuestionOf, interviewQuestionsSchema, MAX_PREVIOUS_ATTEMPTS, overallScore, usableQuestions, withPreviousAttempt } from "../src/interview";

test("questions are trimmed, deduplicated and must reach the requested count", () => {
  const values = ["  Hãy kể về dự án CV Fit?  ", "hãy kể về dự án cv fit?", "Ngắn?", 42, "Bạn xử lý lỗi API thế nào?", "Bạn kiểm thử ra sao?"];
  assert.deepEqual(usableQuestions(values, 3), ["Hãy kể về dự án CV Fit?", "Bạn xử lý lỗi API thế nào?", "Bạn kiểm thử ra sao?"]);
  assert.equal(usableQuestions(values, 5), null);
});

test("sessions hold 3 to 5 questions", () => {
  const question = (n: number) => `Câu hỏi phỏng vấn số ${n}?`;
  assert.equal(interviewQuestionsSchema.safeParse([1, 2, 3].map(question)).success, true);
  assert.equal(interviewQuestionsSchema.safeParse([1, 2, 3, 4, 5].map(question)).success, true);
  assert.equal(interviewQuestionsSchema.safeParse([1, 2].map(question)).success, false);
});

test("a follow-up question is read only from a usable evaluation", () => {
  assert.equal(followUpQuestionOf({ follow_up_question: "  Bạn đo hiệu năng bằng cách nào?  " }), "Bạn đo hiệu năng bằng cách nào?");
  assert.equal(followUpQuestionOf({ follow_up_question: "Vì sao?" }), null);
  assert.equal(followUpQuestionOf({ follow_up_question: null }), null);
  assert.equal(followUpQuestionOf(null), null);
});

test("earlier attempts are kept newest last and capped", () => {
  const attempt = (n: number) => ({ answer_text: `answer ${n}`, evaluation: { score: n }, follow_up: null, created_at: null });
  let history = withPreviousAttempt(undefined, attempt(1));
  for (let n = 2; n <= 7; n++) history = withPreviousAttempt(history, attempt(n));
  assert.equal(history.length, MAX_PREVIOUS_ATTEMPTS);
  assert.deepEqual(history.map((item) => item.answer_text), ["answer 3", "answer 4", "answer 5", "answer 6", "answer 7"]);
});

test("the session score waits for every main question", () => {
  assert.equal(overallScore([{ evaluation: { score: 60 } }, { evaluation: { score: 81 } }], 3), null);
  assert.equal(overallScore([{ evaluation: { score: 60 } }, { evaluation: { score: 81 } }, { evaluation: {} }], 3), 47);
  assert.equal(overallScore([], 0), null);
});

test("the audio cache evicts the least recently used clip", () => {
  const cache = new LruCache<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});
