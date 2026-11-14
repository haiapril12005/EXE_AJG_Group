import assert from "node:assert/strict";
import test from "node:test";
import { estimateCostVnd, featureOf, tokensOf } from "../src/aiUsage";
import { buildActivity, buildAiUsageReport, buildJobStats } from "../src/adminAnalytics";

const PRICING = { inputUsdPerM: 1, outputUsdPerM: 4, usdVnd: 25000 };

test("each AI route is attributed to its feature", () => {
  assert.equal(featureOf("POST", "/analyze"), "analysis");
  assert.equal(featureOf("POST", "/analyses/abc/unlock"), "interview_questions");
  assert.equal(featureOf("POST", "/interviews"), "interview_questions");
  assert.equal(featureOf("POST", "/interviews/abc/answers"), "interview_feedback");
  assert.equal(featureOf("POST", "/interviews/abc/answers/0/follow-up"), "interview_feedback");
  assert.equal(featureOf("POST", "/interviews/abc/transcribe"), "speech_to_text");
  assert.equal(featureOf("GET", "/interviews/abc/questions/1/audio"), "text_to_speech");
  assert.equal(featureOf("POST", "/cv/upload"), "cv_structure");
  assert.equal(featureOf("POST", "/cv/abc/evaluate"), "cv_quality");
  assert.equal(featureOf("POST", "/ai/rewrite-section"), "cv_rewrite");
  assert.equal(featureOf("POST", "/chat"), "chat");
  assert.equal(featureOf("GET", "/jobs"), "other");
});

test("token counts are read from the Gemini usage block and a missing total is summed", () => {
  assert.deepEqual(tokensOf({ usage: { total_input_tokens: 1000, total_output_tokens: 200, total_thought_tokens: 50, total_tokens: 1250 } }),
    { input: 1000, output: 200, thought: 50, total: 1250 });
  assert.deepEqual(tokensOf({ usage: { total_input_tokens: 10, total_output_tokens: 5 } }), { input: 10, output: 5, thought: 0, total: 15 });
  assert.deepEqual(tokensOf(undefined), { input: 0, output: 0, thought: 0, total: 0 });
});

test("thinking tokens are billed at the output price", () => {
  // 1M input at $1 + (0.5M output + 0.5M thought) at $4 = $5 = 125,000đ
  assert.equal(estimateCostVnd({ input: 1_000_000, output: 500_000, thought: 500_000 }, PRICING), 125_000);
});

test("activity splits the doubled range into this period and the one before", () => {
  const rows = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map((day, index) => ({
    day, new_users: index + 1, analyses: 1, interviews: 0, cvs: 2
  }));
  const activity = buildActivity(2, rows, { signed_up: 10, has_cv: 6, analyzed: 4, interviewed: 2, paid: 1, active_7d: 3 });
  assert.deepEqual(activity.daily.map((row) => row.day), ["2026-11-03", "2026-11-04"]);
  assert.equal(activity.current.new_users, 7);
  assert.equal(activity.previous.new_users, 3);
  assert.equal(activity.funnel.analyzed, 4);
});

test("the AI report fills empty days and ranks features by cost", () => {
  const rows = [
    { day: "2026-11-14", feature: "chat", model: "m", calls: 10, failed: 1, input_tokens: 10_000, output_tokens: 1_000, thought_tokens: 0, total_tokens: 11_000, avg_latency_ms: 1000 },
    { day: "2026-11-13", feature: "analysis", model: "m", calls: 2, failed: 0, input_tokens: 100_000, output_tokens: 20_000, thought_tokens: 5_000, total_tokens: 125_000, avg_latency_ms: 4000 }
  ];
  const report = buildAiUsageReport(3, rows, [{ user_id: "u1", calls: 3, input_tokens: 1000, output_tokens: 0, thought_tokens: 0, total_tokens: 1000 }],
    new Map([["u1", { user_code: "12345678", email: "a@b.c", full_name: "A" }]]), PRICING, new Date("2026-11-14T05:00:00Z"));
  assert.deepEqual(report.daily.map((row) => row.day), ["2026-11-12", "2026-11-13", "2026-11-14"]);
  assert.equal(report.daily[0].calls, 0);
  assert.equal(report.totals.calls, 12);
  assert.equal(report.totals.failed, 1);
  assert.equal(report.totals.avg_latency_ms, Math.round((1000 * 10 + 4000 * 2) / 12));
  assert.equal(report.by_feature[0].feature, "analysis");
  assert.equal(report.by_feature[0].label, "Phân tích CV–JD");
  assert.equal(report.top_users[0].email, "a@b.c");
});

test("job stats count active postings by source and category", () => {
  const stats = buildJobStats([
    { source: "greenhouse", category: "backend" },
    { source: "greenhouse", category: null },
    { source: "lever", category: "backend" }
  ], 4, "2026-11-14T00:00:00Z");
  assert.equal(stats.active, 3);
  assert.equal(stats.inactive, 4);
  assert.deepEqual(stats.by_source, [{ source: "greenhouse", active: 2 }, { source: "lever", active: 1 }]);
  assert.equal(stats.by_category[0].category, "backend");
  assert.equal(stats.by_category[0].active, 2);
});
