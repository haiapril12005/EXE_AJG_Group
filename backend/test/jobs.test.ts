import assert from "node:assert/strict";
import test from "node:test";
import { fetchJobSource, mapAshbyJobs, mapGreenhouseJobs, mapLeverJobs, mapSmartRecruitersJob, type JobSource } from "../src/jobs/connectors";
import { cityOf, htmlToText, isSyncDue, isVietnamLocation, JD_MAX_LENGTH, planMissedScans } from "../src/jobs/normalize";

const body = "Build backend services with TypeScript and PostgreSQL for a growing product team.";
const greenhouse: JobSource = { type: "greenhouse", key: "axon", company: "Axon" };
const smartRecruiters: JobSource = { type: "smartrecruiters", key: "Endava", company: "Endava" };
const lever: JobSource = { type: "lever", key: "lalamove", company: "Lalamove" };
const ashby: JobSource = { type: "ashby", key: "acme", company: "Acme" };

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

test("Lever keeps postings with any Vietnam location and merges description, lists and closing text", () => {
  const result = mapLeverJobs(lever, [
    { id: "a1", text: "Driver Operations Associate", hostedUrl: "https://jobs.lever.co/lalamove/a1",
      createdAt: Date.parse("2026-10-02T00:00:00Z"),
      categories: { location: "Singapore", allLocations: ["Singapore", "Ho Chi Minh City"] },
      description: `<div>${body}</div>`,
      lists: [{ text: "Requirements", content: "<li>SQL</li><li>English</li>" }],
      additional: "<p>Apply now</p>" },
    { id: "a2", text: "Remote in Vietnam", hostedUrl: "https://jobs.lever.co/lalamove/a2", country: "VN",
      categories: { location: "Remote" }, description: body },
    { id: "a3", text: "Elsewhere", hostedUrl: "https://jobs.lever.co/lalamove/a3", country: "SG",
      categories: { location: "Singapore" }, description: body }
  ]);
  assert.deepEqual(result.seenIds, ["a1", "a2"]);
  const [first, second] = result.jobs;
  assert.equal(first.source, "lever");
  assert.equal(first.location, "Ho Chi Minh City");
  assert.equal(first.city, "Hồ Chí Minh");
  assert.equal(first.posted_at, "2026-10-02T00:00:00.000Z");
  assert.equal(first.description, `${body}\nRequirements\n- SQL\n- English\nApply now`);
  assert.equal(second.location, "Remote");
  assert.equal(second.posted_at, null);
});

test("Ashby keeps listed Vietnam postings, including ones only in a secondary location", () => {
  const result = mapAshbyJobs(ashby, [
    { id: "b1", title: "Backend Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/b1", isListed: true,
      publishedAt: "2026-10-05T08:00:00.000+00:00", location: "Hanoi", descriptionHtml: `<p>${body}</p>` },
    { id: "b2", title: "Data Analyst", jobUrl: "https://jobs.ashbyhq.com/acme/b2", location: "Singapore",
      secondaryLocations: [{ location: "Remote", address: { addressCountry: "Vietnam" } }], descriptionPlain: body },
    { id: "b3", title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/b3", isListed: false, location: "Hanoi", descriptionHtml: body },
    { id: "b5", title: "Web3 Security Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/b5", location: "Vietnam",
      address: { postalAddress: { addressLocality: "Ho Chi Minh City", addressCountry: "Vietnam" } }, descriptionHtml: body },
    { id: "b4", title: "Elsewhere", jobUrl: "https://jobs.ashbyhq.com/acme/b4", location: "Singapore",
      address: { postalAddress: { addressCountry: "Singapore" } }, descriptionHtml: body }
  ]);
  assert.deepEqual(result.seenIds, ["b1", "b2", "b5"]);
  assert.deepEqual(result.jobs.map((job) => [job.source, job.location, job.city]), [
    ["ashby", "Hanoi", "Hà Nội"],
    ["ashby", "Remote, Vietnam", "Việt Nam"],
    ["ashby", "Ho Chi Minh City, Vietnam", "Hồ Chí Minh"]
  ]);
  assert.equal(result.jobs[0].posted_at, "2026-10-05T08:00:00.000+00:00");
  assert.equal(result.jobs[1].description, body);
});

test("each source type reaches its own public job board API", async () => {
  const realFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    requested.push(String(url));
    return new Response(JSON.stringify(String(url).includes("lever") ? [] : { jobs: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    await fetchJobSource({ type: "lever", key: "lalamove", company: "Lalamove" });
    await fetchJobSource({ type: "ashby", key: "acme co", company: "Acme" });
    await fetchJobSource({ type: "greenhouse", key: "axon", company: "Axon" });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(requested, [
    "https://api.lever.co/v0/postings/lalamove?mode=json",
    "https://api.ashbyhq.com/posting-api/job-board/acme%20co",
    "https://boards-api.greenhouse.io/v1/boards/axon/jobs?content=true"
  ]);
});
