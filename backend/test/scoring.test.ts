import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceBoundRewrite, assertStructuredCvGrounded, scoreRequirements } from "../src/scoring";

test("CV extraction accepts only facts present in the uploaded text", () => {
  assert.doesNotThrow(() => assertStructuredCvGrounded("Built API with Node.js for 12 users", ["Node.js", "12"]));
  assert.throws(() => assertStructuredCvGrounded("Built API with Node.js", ["Kubernetes"]), /source evidence/);
  assert.throws(() => assertStructuredCvGrounded("Built API with Node.js", ["50 users"]), /number/);
});

test("fixed weights score verified CV evidence and redistribute absent categories", () => {
  const jd = "Cần React. Có kinh nghiệm triển khai dự án. Tiếng Anh tốt.";
  const cv = "Tôi dùng React trong dự án học tập. Đã triển khai dự án CV Fit.";
  const result = scoreRequirements([
    { category: "skills", jd_quote: "Cần React", cv_quote: "dùng React" },
    { category: "experience", jd_quote: "Có kinh nghiệm triển khai dự án", cv_quote: "triển khai dự án CV Fit" },
    { category: "education", jd_quote: "Tiếng Anh tốt", cv_quote: null }
  ], cv, jd);
  assert.equal(result.score, 80);
  assert.equal(result.breakdown.length, 3);
  assert.equal(result.requirements[2].matched, false);
});

test("rejects invented quotes from CV and JD", () => {
  assert.throws(() => scoreRequirements([
    { category: "skills", jd_quote: "Kubernetes", cv_quote: "React" }
  ], "React", "Cần React"), /JD quote/);
  assert.throws(() => scoreRequirements([
    { category: "skills", jd_quote: "Cần React", cv_quote: "Kubernetes" }
  ], "React", "Cần React"), /CV quote/);
});

test("rewrites require source quotes and cannot invent numeric achievements", () => {
  assert.equal(assertSourceBoundRewrite("Phát triển API với Node.js cho 12 người dùng", [
    { text: "Phát triển API Node.js cho 12 người dùng", source_quote: "API với Node.js cho 12 người dùng" }
  ]), "- Phát triển API Node.js cho 12 người dùng");
  assert.throws(() => assertSourceBoundRewrite("Phát triển API", [
    { text: "Tăng doanh thu 50%", source_quote: "Phát triển API" }
  ]), /number/);
  assert.throws(() => assertSourceBoundRewrite("Phát triển API", [
    { text: "Phát triển API", source_quote: "Kubernetes" }
  ]), /source evidence/);
  assert.throws(() => assertSourceBoundRewrite("Dùng React cho giao diện", [
    { text: "Tăng doanh thu nhờ React", source_quote: "React" }
  ]), /sufficiently supported/);
});
