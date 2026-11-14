import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_RULES, categoriesOfFilter, categorizeJob, JOB_CATEGORIES, JOB_CATEGORY_FILTERS, JOB_CATEGORY_GROUPS } from "../src/jobs/categories";

test("job titles land in the occupation a job seeker would look under", () => {
  const cases: [string, string][] = [
    ["Senior Backend Engineer (Golang)", "backend"],
    ["Java Developer", "backend"],
    ["Node.js Engineer", "backend"],
    [".NET Developer", "backend"],
    ["Front-end Developer - ReactJS", "frontend"],
    ["Fullstack Engineer (React/Node)", "fullstack"],
    ["iOS Developer", "mobile"],
    ["React Native Developer", "mobile"],
    ["DevOps / SRE", "devops"],
    ["Cloud Infrastructure Engineer", "devops"],
    ["QA Automation Engineer", "qa"],
    ["Manual Tester", "qa"],
    ["Security Engineer", "security"],
    ["Embedded Software Engineer", "embedded"],
    ["Unity Game Developer", "game"],
    ["Technical Support Engineer", "it_support"],
    ["Engineering Manager, Payments", "software"],
    ["Software Engineer", "software"],
    ["Lập trình viên", "software"],
    ["Data Engineer", "data_engineer"],
    ["Data Analyst", "data_analyst"],
    ["Business Intelligence Developer", "data_analyst"],
    ["Machine Learning Engineer", "ai_ml"],
    ["AI Engineer", "ai_ml"],
    ["Senior Product Designer", "ui_ux"],
    ["UX/UI Designer", "ui_ux"],
    ["Graphic Designer", "graphic"],
    ["Product Manager - Growth Platform", "product"],
    ["Technical Project Manager", "project"],
    ["Scrum Master", "project"],
    ["Business Analyst", "business_analyst"],
    ["Product Marketing Manager", "marketing"],
    ["Performance Marketing Specialist", "marketing"],
    ["Content Writer", "content"],
    ["PR & Communications Executive", "content"],
    ["Sales Engineer", "sales"],
    ["Account Executive, SMB", "sales"],
    ["Nhân viên kinh doanh", "sales"],
    ["Business Development Manager", "bd"],
    ["Key Account Manager", "bd"],
    ["Customer Success Manager", "customer_service"],
    ["Chăm sóc khách hàng", "customer_service"],
    ["Senior Accountant", "accounting"],
    ["Kế toán tổng hợp", "accounting"],
    ["Financial Analyst", "finance"],
    ["Risk Manager", "finance"],
    ["Talent Acquisition Specialist", "hr"],
    ["HR Business Partner", "hr"],
    ["Legal Counsel", "legal"],
    ["Compliance Officer", "legal"],
    ["Office Administrator", "admin"],
    ["Executive Assistant", "admin"],
    ["Data Entry Clerk", "admin"],
    ["Operations Manager", "operations"],
    ["Supply Chain Planner", "logistics"],
    ["Procurement Specialist", "logistics"],
    ["Mechanical Engineer", "manufacturing"],
    ["QC Inspector", "manufacturing"],
    ["Civil Engineer", "construction"],
    ["Interior Designer", "construction"],
    ["English Teacher", "education"],
    ["Pharmacist", "healthcare"],
    ["Chef de Partie", "hospitality"],
    ["Japanese Interpreter", "translation"],
    ["Mascot Performer", "other"],
  ];
  const wrong = cases.filter(([title, category]) => categorizeJob(title) !== category)
    .map(([title, category]) => `${title}: expected ${category}, got ${categorizeJob(title)}`);
  assert.deepEqual(wrong, []);
});

test("every rule points at a listed occupation and every occupation but Khác has a rule", () => {
  const ids = JOB_CATEGORIES.map((category) => category.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(JOB_CATEGORY_FILTERS).size, JOB_CATEGORY_FILTERS.length);
  const ruled = new Set(CATEGORY_RULES.map(([id]) => id));
  assert.deepEqual([...ruled].filter((id) => !ids.includes(id)), []);
  assert.deepEqual(ids.filter((id) => !ruled.has(id)), ["other"]);
  assert.ok(JOB_CATEGORIES.every((category) => category.label.trim()));
});

test("a group filter covers all of its occupations and a single occupation covers itself", () => {
  const it = JOB_CATEGORY_GROUPS.find((group) => group.id === "group-it")!;
  assert.deepEqual(categoriesOfFilter("group-it"), it.categories.map((category) => category.id));
  assert.deepEqual(categoriesOfFilter("backend"), ["backend"]);
});
