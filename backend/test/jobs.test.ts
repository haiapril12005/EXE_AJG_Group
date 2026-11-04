import assert from "node:assert/strict";
import test from "node:test";
import { mapGreenhouseJobs, mapSmartRecruitersJob, type JobSource } from "../src/jobs/connectors";
import { cityOf, htmlToText, isSyncDue, isVietnamLocation, JD_MAX_LENGTH, planMissedScans } from "../src/jobs/normalize";

const body = "Build backend services with TypeScript and PostgreSQL for a growing product team.";
const greenhouse: JobSource = { type: "greenhouse", key: "axon", company: "Axon" };
const smartRecruiters: JobSource = { type: "smartrecruiters", key: "Endava", company: "Endava" };

test("HTML, escaped HTML and entities become readable text", () => {
  assert.equal(htmlToText("<p>Hello&nbsp;<b>team</b></p><ul><li>One</li><li>Two &amp; three</li></ul>"),
    "Hello team\n- One\n- Two & three");
  assert.equal(htmlToText("&lt;div&gt;&lt;p&gt;Lead engineers&lt;/p&gt;&lt;/div&gt;"), "Lead engineers");
  assert.equal(htmlToText("<script>alert(1)</script><style>p{}</style>Safe"), "Safe");
  assert.equal(htmlToText("Dấu &#7871; &#x1EBF;"), "Dấu ế ế");
});

test("Vietnamese locations are recognized with or without diacritics", () => {
  for (const location of ["Ho Chi Minh City, Vietnam", "HCMC", "Hà Nội", "Da Nang", "Viet Nam", "Remote - Vietnam"]) {
    assert.equal(isVietnamLocation(location), true, location);
  }
  assert.equal(isVietnamLocation("Singapore"), false);
  assert.deepEqual(["HCMC", "Hà Nội", "Đà Nẵng", "Vietnam"].map(cityOf), ["Hồ Chí Minh", "Hà Nội", "Đà Nẵng", "Việt Nam"]);
});

test("Greenhouse keeps Vietnam postings and masks recruiter contacts", () => {
  const result = mapGreenhouseJobs(greenhouse, [
    { id: 1, title: "Android Engineer", absolute_url: "https://example.com/1", first_published: "2026-10-01T00:00:00Z",
      location: { name: "Ho Chi Minh City, Vietnam" }, content: `&lt;p&gt;${body} Contact hr+jobs@axon.com or 090.123.4567&lt;/p&gt;` },
    { id: 2, title: "Elsewhere", absolute_url: "https://example.com/2", location: { name: "Singapore" }, content: body }
  ]);
  assert.deepEqual(result.seenIds, ["1"]);
  assert.equal(result.jobs[0].city, "Hồ Chí Minh");
  assert.equal(result.jobs[0].posted_at, "2026-10-01T00:00:00Z");
  assert.match(result.jobs[0].description, /Contact \[MASKED_EMAIL\] or \[MASKED_PHONE\]$/);
});

test("postings that cannot be analyzed or linked are skipped but still count as listed", () => {
  const result = mapGreenhouseJobs(greenhouse, [
    { id: 3, title: "Too short", absolute_url: "https://example.com/3", location: { name: "Vietnam" }, content: "<p>Short</p>" },
    { id: 4, title: "Unsafe link", absolute_url: "javascript:alert(1)", location: { name: "Vietnam" }, content: body }
  ]);
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.seenIds, ["3", "4"]);
  assert.equal(result.skipped, 2);
});

test("SmartRecruiters sections merge in order, without the company blurb", () => {
  const job = mapSmartRecruitersJob(smartRecruiters, {
    id: "744", name: "Procurement Specialist", postingUrl: "https://jobs.smartrecruiters.com/Endava/744",
    releasedDate: "2026-10-23T09:25:40.624Z",
    location: { fullLocation: "Ho Chi Minh City, , Vietnam" },
    jobAd: { sections: {
      companyDescription: { title: "Company", text: "<p>We are great</p>" },
      jobDescription: { title: "Job Description", text: `<p>${body}</p>` },
      qualifications: { title: "Qualifications", text: "<ul><li>TypeScript</li></ul>" }
    } }
  });
  assert.equal(job?.location, "Ho Chi Minh City, Vietnam");
  assert.equal(job?.description, `Job Description\n${body}\nQualifications\n- TypeScript`);
});

test("descriptions stop at the length /analyze accepts", () => {
  const job = mapSmartRecruitersJob(smartRecruiters, {
    id: "745", name: "Long", postingUrl: "https://example.com/745",
    jobAd: { sections: { jobDescription: { text: `<p>${"word ".repeat(10_000)}</p>` } } }
  });
  assert.ok(job && job.description.length <= JD_MAX_LENGTH);
});

test("a posting is hidden only after two missed scans in a row", () => {
  const active = [
    { external_id: "seen", missed_scans: 1 },
    { external_id: "first-miss", missed_scans: 0 },
    { external_id: "second-miss", missed_scans: 1 }
  ];
  const plan = planMissedScans(active, new Set(["seen"]));
  assert.deepEqual(plan.strike.map((item) => item.external_id), ["first-miss"]);
  assert.deepEqual(plan.hide.map((item) => item.external_id), ["second-miss"]);
});

test("the catalog syncs when empty or older than the interval, not on every restart", () => {
  const hour = 3_600_000;
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(isSyncDue(null, now, 12 * hour), true);
  assert.equal(isSyncDue("2026-11-04T06:00:00Z", now, 12 * hour), false);
  assert.equal(isSyncDue("2026-11-03T23:59:00Z", now, 12 * hour), true);
  assert.equal(isSyncDue("not a date", now, 12 * hour), true);
});
