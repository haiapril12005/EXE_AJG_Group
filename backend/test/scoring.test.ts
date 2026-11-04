import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceBoundRewrite, assertStructuredCvGrounded, groundEvidence, groundInterviewFeedback, groundProjects, scoreRequirements } from "../src/scoring";

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

test("an invented JD quote is dropped and an invented CV quote counts as unmet", () => {
  const result = scoreRequirements([
    { category: "skills", jd_quote: "Kubernetes", cv_quote: "React" },
    { category: "skills", jd_quote: "Cần React", cv_quote: "Kubernetes" },
    { category: "constructor", jd_quote: "Cần React", cv_quote: null }
  ], "React", "Cần React");
  assert.deepEqual(result.requirements, [{ category: "skills", jd_quote: "Cần React", cv_quote: null, matched: false }]);
  assert.equal(result.score, 0);
  assert.equal(result.dropped, 2);
  assert.equal(result.unverified, 1);
});

test("analysis fails only when no JD requirement can be verified", () => {
  assert.throws(() => scoreRequirements([
    { category: "skills", jd_quote: "Kubernetes", cv_quote: null }
  ], "React", "Cần React"), /verified/);
});

test("a JD line listed twice counts once, as met when either copy has CV evidence", () => {
  const result = scoreRequirements([
    { category: "skills", jd_quote: "Cần React", cv_quote: "Angular" },
    { category: "skills", jd_quote: "cần  react", cv_quote: "dùng React" },
    { category: "skills", jd_quote: "Biết SQL", cv_quote: "" }
  ], "Tôi dùng React", "Cần React. Biết SQL.");
  assert.equal(result.requirements.length, 2);
  assert.deepEqual(result.requirements[0], { category: "skills", jd_quote: "Cần React", cv_quote: "dùng React", matched: true });
  assert.equal(result.requirements[1].matched, false);
  assert.equal(result.score, 50);
});

test("an English JD keeps its quotes in English", () => {
  const jd = "Requirements: 3+ years of experience with TypeScript. Fluent English.";
  const result = scoreRequirements([
    { category: "experience", jd_quote: "3+ years of experience with TypeScript", cv_quote: null },
    { category: "education", jd_quote: "Tiếng Anh lưu loát", cv_quote: null }
  ], "TypeScript", jd);
  assert.deepEqual(result.requirements.map((item) => item.jd_quote), ["3+ years of experience with TypeScript"]);
});

test("project feedback needs the project name and a quote from the CV", () => {
  const cv = "Dự án CV Fit: xây dựng API bằng Node.js";
  const projects = [
    { project_name: "CV Fit", issue: "", suggestion: "", evidence: "xây dựng API bằng Node.js" },
    { project_name: "Shop Online", issue: "", suggestion: "", evidence: "xây dựng API bằng Node.js" },
    { project_name: "CV Fit", issue: "", suggestion: "", evidence: "triển khai Kubernetes" }
  ];
  assert.deepEqual(groundProjects(projects, cv).map((item) => item.project_name), ["CV Fit"]);
  assert.equal(groundEvidence([{ claim: "x", quote: "Node.js" }, { claim: "y", quote: "Python" }], cv).length, 1);
});

test("interview feedback keeps strengths it can quote and unquoted improvements", () => {
  const answer = "Em đã tối ưu truy vấn SQL cho trang báo cáo.";
  const result = groundInterviewFeedback({
    score: 70,
    strengths: [{ claim: "Có ví dụ", quote: "tối ưu truy vấn SQL" }, { claim: "Bịa", quote: "giảm 50% thời gian" }],
    improvements: [
      { finding: "Thiếu số liệu", suggestion: "Nêu kết quả", answer_quote: "không có trong câu trả lời" },
      { finding: "Thiếu bối cảnh", suggestion: "Nêu quy mô", answer_quote: "trang báo cáo" }
    ]
  }, answer);
  assert.deepEqual(result.strengths.map((item) => item.claim), ["Có ví dụ"]);
  assert.deepEqual(result.improvements.map((item) => item.answer_quote), [null, "trang báo cáo"]);
  assert.equal(result.score, 70);
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
