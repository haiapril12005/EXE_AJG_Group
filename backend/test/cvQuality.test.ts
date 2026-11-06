import assert from "node:assert/strict";
import test from "node:test";
import { emptyCvData } from "../src/cvData";
import { inspectCvQuality, scoreQualityIssues } from "../src/cvQuality";

test("empty CV receives evidence-based missing-section findings", () => {
  const result = inspectCvQuality(emptyCvData(), "");
  assert.ok(result.score < 50);
  assert.ok(result.issues.some((item) => item.finding.includes("họ tên")));
  assert.ok(result.issues.every((item) => item.evidence_quote === null));
});

test("quality score includes AI findings as fixed severity penalties", () => {
  assert.equal(scoreQualityIssues([
    { category: "content", severity: "high", finding: "Thiếu bằng chứng", suggestion: "Bổ sung", evidence_quote: "Dự án cá nhân" },
    { category: "presentation", severity: "low", finding: "Dòng dài", suggestion: "Tách dòng", evidence_quote: null }
  ]), 79);
});
