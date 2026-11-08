import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cvDataSchema, cvDataToText, emptyCvData, extractContacts, extractLinks, maskText, stripNul } from "../src/cvData";
import { CV_TEMPLATE_IDS, MAX_IMAGE_DATA_URL } from "../src/cvData";

test("NUL characters from PDF text are removed so Postgres can store it", () => {
  assert.equal(stripNul("Ph\u0000ân tích CV\u0000"), "Phân tích CV");
  assert.equal(stripNul("Không có ký tự lạ"), "Không có ký tự lạ");
});

test("masks Vietnamese phone numbers in common written formats", () => {
  for (const phone of [
    "0901234567", "090 123 4567", "090.123.4567", "090-123-4567", "0901 234 567",
    "+84 901 234 567", "+84901234567", "84901234567", "(+84) 901 234 567",
    "+84 (0) 901 234 567", "(028) 3822 1234", "024 3826 1234"
  ]) {
    assert.equal(maskText(`SĐT: ${phone} nhé`), "SĐT: [MASKED_PHONE] nhé", phone);
  }
});

test("masks whole email addresses including plus tags and subdomains", () => {
  assert.equal(maskText("mail a.b+tag@gmail.com."), "mail [MASKED_EMAIL].");
  assert.equal(maskText("x_y%z@mail.fpt.edu.vn"), "[MASKED_EMAIL]");
  assert.equal(maskText("0901234567@gmail.com"), "[MASKED_EMAIL]");
});

test("masks social profile links but keeps project repositories", () => {
  assert.equal(maskText("https://www.linkedin.com/in/nguyen-van-a"), "[MASKED_LINK]");
  assert.equal(maskText("(fb.com/nguyenvana)"), "([MASKED_LINK])");
  assert.equal(maskText("github.com/demo/cv-fit"), "github.com/demo/cv-fit");
});

test("leaves dates, scores and other numbers untouched", () => {
  for (const value of [
    "GPA 3.5/4.0", "2019 - 2023", "03/2020 - 05/2021", "02.2019-08.2020", "05.12.2020-10.12.2020",
    "02.2019 - 08.2020", "MSSV 12345678", "84.5%", "1.000.000.000 VND", "Tăng 0.5 lần"
  ]) {
    assert.equal(maskText(value), value);
  }
});

test("masking is idempotent so stored text can be masked again before use", () => {
  const once = maskText("090.123.4567 và a+b@gmail.com");
  assert.equal(maskText(once), once);
});

test("contacts skip date ranges and keep the original formatting", () => {
  assert.deepEqual(extractContacts("02.2019-08.2020\n090.123.4567 a.b+tag@gmail.com"), {
    email: "a.b+tag@gmail.com", phone: "090.123.4567"
  });
});

test("links keep profile URLs that masking hides from the AI", () => {
  assert.deepEqual(extractLinks("linkedin.com/in/a, https://github.com/a. Xem www.a.dev"), [
    { label: "LinkedIn", url: "linkedin.com/in/a" },
    { label: "GitHub", url: "https://github.com/a" },
    { label: "Website", url: "www.a.dev" }
  ]);
});

test("CVs saved before the new fields existed still parse", () => {
  const cv = cvDataSchema.parse({
    personal_info: { name: "A" },
    education: [{ school: "FPT" }],
    experience: [{ company: "B", role: "Dev", description: "Làm API" }]
  });
  assert.equal(cv.education[0].start_date, "");
  assert.equal(cv.experience[0].end_date, "");
  assert.deepEqual([cv.languages, cv.certificates, cv.links], [[], [], []]);
});

test("new CV fields reach the text that is analyzed", () => {
  const text = cvDataToText({
    ...emptyCvData("A"),
    experience: [{ company: "B", role: "Dev", start_date: "01/2024", end_date: "Hiện tại", description: "Làm API" }],
    languages: [{ name: "Tiếng Anh", level: "IELTS 7.0" }],
    certificates: [{ name: "AWS SAA", issuer: "Amazon", year: "2025" }],
    links: [{ label: "GitHub", url: "github.com/a" }]
  });
  assert.match(text, /Dev - B - 01\/2024 - Hiện tại/);
  assert.match(text, /Tiếng Anh - IELTS 7\.0/);
  assert.match(text, /AWS SAA - Amazon - 2025/);
  assert.match(text, /GitHub: github\.com\/a/);
});

test("every template the CV editor offers is one the API accepts, and the other way round", () => {
  const editor = readFileSync(new URL("../../frontend/app/cv-editor.tsx", import.meta.url), "utf8");
  const start = editor.indexOf("export const CV_TEMPLATES");
  const block = editor.slice(start, editor.indexOf("] as const;", start));
  const offered = [...block.matchAll(/id: "([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(offered, [...CV_TEMPLATE_IDS]);
  for (const template of CV_TEMPLATE_IDS) {
    assert.equal(cvDataSchema.safeParse({ template }).success, true, template);
  }
  assert.equal(cvDataSchema.safeParse({ template: "unknown" }).success, false);
});

test("a CV photo must be a JPEG, PNG or WebP data URL of bounded size, and never reaches the analyzed text", () => {
  const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
  assert.equal(cvDataSchema.parse({ photo }).photo, photo);
  assert.equal(cvDataSchema.parse({}).photo, "");
  for (const bad of [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PGI+aGk8L2I+",
    "javascript:alert(1)",
    "https://example.com/photo.jpg",
    "data:image/jpeg;base64,<script>alert(1)</script>",
    `data:image/jpeg;base64,${"A".repeat(MAX_IMAGE_DATA_URL)}`
  ]) {
    assert.equal(cvDataSchema.safeParse({ photo: bad }).success, false, bad.slice(0, 40));
  }
  const text = cvDataToText(cvDataSchema.parse({ photo, personal_info: { name: "Minh Anh" } }));
  assert.equal(text.includes("base64"), false);
});
