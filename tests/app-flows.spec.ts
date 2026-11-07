import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";

const EMAIL = "demo@example.com";
const PASSWORD = "DemoPassword!2026";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const CV_ID = "00000000-0000-4000-8000-000000000002";
const ANALYSIS_ID = "00000000-0000-4000-8000-000000000003";
const INTERVIEW_ID = "00000000-0000-4000-8000-000000000004";
const JOB_ID = "00000000-0000-4000-8000-000000000005";
const OLD_CV_ID = "00000000-0000-4000-8000-000000000006";
const EVAL_NEW = "00000000-0000-4000-8000-000000000007";
const EVAL_OLD = "00000000-0000-4000-8000-000000000008";
const JD = "We need a Backend Developer with TypeScript, REST APIs and PostgreSQL experience.";
const USER = {
  id: USER_ID, aud: "authenticated", role: "authenticated", email: EMAIL,
  created_at: "2026-01-01T00:00:00.000Z", app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Flow Demo" }, email_confirmed_at: "2026-01-01T00:00:00.000Z",
};
const CV_DATA = {
  template: "modern",
  personal_info: { name: "Flow Demo", email: "demo@example.com", phone: "", title: "Backend Developer" },
  summary: "Original summary about REST APIs.",
  education: [{ school: "FPT University", major: "", gpa: "", start_date: "", end_date: "" }],
  experience: [{ company: "Acme", role: "Intern", start_date: "01/2025", end_date: "", description: "Original experience text." }],
  projects: [{ name: "CV Fit", technologies: [], description: "Original project text." }],
  skills: ["TypeScript"], languages: [], certificates: [], links: [],
};
const ANALYSIS = {
  analysis_id: ANALYSIS_ID, id: ANALYSIS_ID, cv_id: CV_ID, jd_text: JD, job_id: null, rci_score: 75,
  layer_1_skills: { matched: ["TypeScript"], missing: ["PostgreSQL"], evidence: [] },
  layer_2_projects: [],
  layer_3_education: { major_matched: false, english_matched: false, notes: "No evidence", evidence: [] },
  layer_4_mock: ["Question one?", "Question two?", "Question three?"],
  is_premium_unlocked: true,
  requirements: [
    { category: "skills", jd_quote: "TypeScript", cv_quote: "TypeScript", matched: true },
    { category: "skills", jd_quote: "PostgreSQL", cv_quote: null, matched: false },
    { category: "experience", jd_quote: "REST APIs and PostgreSQL experience", cv_quote: null, matched: false },
  ],
  scoring_breakdown: [
    { category: "skills", weight: 45, matched: 1, total: 2, score: 50 },
    { category: "experience", weight: 35, matched: 0, total: 1, score: 0 },
  ],
};
const FEEDBACK = { score: 70, strengths: [], improvements: [] };
const FOLLOW_UP_QUESTION = "How did you measure the API latency you mentioned?";
type Interview = {
  id: string; analysis_id: string; status: string; overall_score: number; questions: string[];
  answers: { question_index: number; answer_text: string; evaluation: Record<string, unknown>; [key: string]: unknown }[];
};
const INTERVIEW: Interview = {
  id: INTERVIEW_ID, analysis_id: ANALYSIS_ID, status: "COMPLETED", overall_score: 70,
  questions: ANALYSIS.layer_4_mock,
  answers: [0, 1, 2].map((question_index) => ({ question_index, answer_text: "A previous answer long enough to submit.", evaluation: FEEDBACK })),
};
// The first question was answered twice, and the interviewer asked a follow-up the second time.
const FOLLOW_UP_INTERVIEW: Interview = {
  ...INTERVIEW,
  answers: INTERVIEW.answers.map((answer, index) => index ? answer : {
    ...answer, evaluation: { ...FEEDBACK, follow_up_question: FOLLOW_UP_QUESTION }, follow_up: null,
    previous_attempts: [{ answer_text: "An earlier, weaker answer without an example.", evaluation: { score: 50, strengths: [], improvements: [] }, follow_up: null, created_at: "2026-10-03T00:00:00.000Z" }],
  }),
};
const EVALUATIONS = [
  { id: EVAL_NEW, quality_score: 81, created_at: "2026-10-05T00:00:00.000Z", issues: [{ category: "content", severity: "low", finding: "Newest finding", suggestion: "Keep going", evidence_quote: null }] },
  { id: EVAL_OLD, quality_score: 74, created_at: "2026-10-01T00:00:00.000Z", issues: [{ category: "content", severity: "medium", finding: "Older finding", suggestion: "Add detail", evidence_quote: null }] },
];
const JOB = {
  id: JOB_ID, company: "Grab", title: "Backend Engineer", location: "Ho Chi Minh City, Vietnam", city: "Hồ Chí Minh",
  url: "https://example.com/job", posted_at: "2026-10-20T00:00:00.000Z",
};

function session() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sub: USER_ID, aud: "authenticated", role: "authenticated", email: EMAIL, iat: issuedAt, exp: issuedAt + 3600,
    })}.dGVzdC1zaWduYXR1cmU`,
    refresh_token: "mock-refresh-token-not-valid-outside-this-test",
    token_type: "bearer", expires_in: 3600, expires_at: issuedAt + 3600, user: USER,
  };
}

async function reply(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status, contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "x-supabase-api-version": "2024-01-01" },
    body: JSON.stringify(body),
  });
}

type Options = { jobsStatus?: number; savedCvs?: boolean; structured?: boolean; interview?: Interview; isAdmin?: boolean };

async function mockServices(context: BrowserContext, { jobsStatus = 200, savedCvs = true, structured = true, interview = INTERVIEW, isAdmin = false }: Options = {}) {
  const posts: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/auth/v1/")) {
      if (request.method() === "OPTIONS") return reply(route, 200, {});
      if (url.pathname === "/auth/v1/token") return reply(route, 200, session());
      if (url.pathname === "/auth/v1/user") return reply(route, 200, USER);
      return reply(route, 200, {});
    }
    if (url.port === "4000" && url.pathname.startsWith("/api/")) {
      if (request.method() === "OPTIONS") return reply(route, 200, {});
      const path = url.pathname.slice("/api".length);
      const method = request.method();
      if (method !== "GET") posts.push({ method, path, body: request.postDataJSON() ?? {} });
      const page = url.searchParams.get("page") ?? "1";
      if (path === "/user/me") return reply(route, 200, { user: { id: USER_ID, email: EMAIL, full_name: "Flow Demo", credits: 0, is_admin: isAdmin, payments_enabled: false } });
      if (path === "/admin/overview") {
        if (!isAdmin) return reply(route, 403, { error: "Chỉ tài khoản quản trị (Admin) mới có quyền truy cập trang thống kê này." });
        return reply(route, 200, {
          overview: {
            generated_at: "2026-11-07T00:00:00.000Z",
            rules: { max_admins: 3, current_admins: 1, remaining_slots: 2 },
            users: { total: 12, admins: 1, new_last_7d: 4, total_credits: 18 },
            cvs: { total: 15, evaluations_total: 9, avg_quality_score: 82 },
            analyses: { total: 20, avg_rci_score: 71, high_match_count: 11 },
            interviews: { total: 8, completed: 5, in_progress: 3, answers_total: 19 },
            revenue: {
              total_vnd: 87000,
              success_count: 3,
              pending_count: 1,
              cancelled_count: 0,
              recent_transactions: [{ order_code: 9001, amount: 29000, status: "SUCCESS", created_at: "2026-11-06T00:00:00.000Z", user_email: EMAIL }]
            },
            jobs: { active_count: 35, last_seen_at: "2026-11-07T00:00:00.000Z" },
            admins: [{ id: USER_ID, email: EMAIL, full_name: "Flow Demo", created_at: "2026-01-01T00:00:00.000Z" }]
          }
        });
      }
      if (path === "/cv") {
        // Two saved CVs, one per page, so the history can page through them.
        const cvs = !savedCvs ? [] : page === "1"
          ? [{ id: CV_ID, original_name: "CV Flow Demo", created_at: "2026-10-01T00:00:00.000Z" }]
          : [{ id: OLD_CV_ID, original_name: "CV cũ năm ngoái", created_at: "2025-10-01T00:00:00.000Z" }];
        return reply(route, 200, { cvs, total: savedCvs ? 2 : 0, page: Number(page), page_size: 1 });
      }
      if (path === `/cv/${CV_ID}`) {
        if (method === "DELETE") return reply(route, 200, { deleted: true });
        return reply(route, 200, method === "GET" ? { cv_id: CV_ID, cv_data: CV_DATA, structured } : { saved: true });
      }
      if (path === `/cv/${CV_ID}/evaluations`) return reply(route, 200, { evaluations: EVALUATIONS });
      if (path === "/evaluations") {
        return reply(route, 200, { evaluations: EVALUATIONS.map(({ id, quality_score, created_at }) => ({ id, cv_id: CV_ID, quality_score, created_at, cv_name: "CV Flow Demo" })), total: 2, page: 1, page_size: 20 });
      }
      if (path === "/cv/create") return reply(route, 201, { cv_id: CV_ID, cv_data: CV_DATA });
      if (path === "/analyses") {
        return reply(route, 200, { analyses: [{ id: ANALYSIS_ID, cv_id: CV_ID, job_id: JOB_ID, jd_preview: JD, rci_score: 75, created_at: "2026-10-02T00:00:00.000Z", cv_name: "CV Flow Demo", job: { title: "Backend Engineer", company: "Grab" } }], total: 1, page: 1, page_size: 20 });
      }
      if (path === `/analyses/${ANALYSIS_ID}`) return reply(route, 200, { analysis: ANALYSIS });
      if (path === "/analyze") return reply(route, 200, ANALYSIS);
      if (path === "/ai/rewrite-section") return reply(route, 200, { new_description: `- Rewritten by AI ${posts.length}` });
      if (path === "/jobs") {
        return jobsStatus === 200
          ? reply(route, 200, { jobs: [JOB], total: 1, page: 1, page_size: 20 })
          : reply(route, jobsStatus, { error: "Kho việc làm chưa sẵn sàng. Hãy chạy migration 004_job_postings.sql rồi chạy npm run jobs:sync." });
      }
      if (path === `/jobs/${JOB_ID}`) return reply(route, 200, { job: { ...JOB, description: `${JD} Join the Grab platform team.` } });
      if (path === "/interviews" && method === "GET") {
        return reply(route, 200, { sessions: [{ id: INTERVIEW_ID, analysis_id: ANALYSIS_ID, status: "COMPLETED", created_at: "2026-10-03T00:00:00.000Z", jd_preview: JD.slice(0, 40), cv_name: "CV Flow Demo", answered: 3, total: 3, overall_score: 70 }], total: 1, page: 1, page_size: 20 });
      }
      if (path === "/interviews") return reply(route, 201, { session: { id: INTERVIEW_ID } });
      if (path === `/interviews/${INTERVIEW_ID}`) return reply(route, 200, { session: interview });
      if (path === `/interviews/${INTERVIEW_ID}/answers`) return reply(route, 200, { evaluation: FEEDBACK, completed: true, overall_score: 70 });
      if (path === `/interviews/${INTERVIEW_ID}/answers/0/follow-up`) {
        return reply(route, 200, { follow_up: { question: FOLLOW_UP_QUESTION, answer_text: "I measured p95 latency with k6 before and after.", evaluation: FEEDBACK } });
      }
      unexpected.push(request.url());
      return reply(route, 500, { error: "Unmocked API request" });
    }
    if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "3100") return route.continue();
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    unexpected.push(request.url());
    return route.abort("blockedbyclient");
  });
  return { posts, unexpected };
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  // Signing in opens the job list; these tests start from the analysis page.
  await expect(page).toHaveURL(/\/jobs$/);
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Phân tích" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("the report sits beside the CV, survives a reload and can be left", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto(`/analysis/${ANALYSIS_ID}`);
  await expect(page.getByRole("heading", { name: "Phân tích mức độ phù hợp" })).toBeVisible();

  const report = await page.locator(".split-left").boundingBox();
  const paper = await page.locator(".split-right").boundingBox();
  expect(report && paper && paper.x).toBeGreaterThan((report?.x ?? 0) + (report?.width ?? 0) - 1);
  expect(Math.abs((report?.y ?? 0) - (paper?.y ?? 9999))).toBeLessThan(5);
  await expect(page.locator(".page-content")).toHaveClass(/page-wide/);
  expect((await page.locator(".page-content").boundingBox())?.width).toBeGreaterThan(1300);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Phân tích mức độ phù hợp" })).toBeVisible();
  await expect(page.locator(".cv-paper")).toContainText("Original summary");

  await page.getByRole("link", { name: "← Về trang chính" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /Tối Ưu Hóa Hồ Sơ/ })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("undo after optimizing the whole CV restores every rewritten section", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto(`/analysis/${ANALYSIS_ID}`);
  await page.getByRole("button", { name: "✨ Tối ưu toàn bộ CV" }).click();
  await expect(page.getByText("AI vừa sửa 3 mục")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hoàn tác" })).toBeEnabled();
  await expect(page.locator(".cv-paper .ai-highlight")).toHaveCount(3);
  await expect(page.locator(".cv-paper")).toContainText("Rewritten by AI");
  expect(posts.filter((post) => post.path === "/ai/rewrite-section")).toHaveLength(3);

  await page.getByRole("button", { name: "Hoàn tác" }).click();
  for (const text of ["Original summary about REST APIs.", "Original project text.", "Original experience text."]) {
    await expect(page.locator(".cv-paper")).toContainText(text);
  }
  await expect(page.locator(".cv-paper")).not.toContainText("Rewritten by AI");
  await expect(page.locator(".cv-paper .ai-highlight")).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("edits made just before leaving the page are still saved", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto(`/cv/${CV_ID}`);
  await page.locator(".cv-title .editable").fill("Senior Backend Developer");
  await page.getByRole("link", { name: "Lịch sử", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect.poll(() => posts.filter((post) => post.path === `/cv/${CV_ID}`).length).toBeGreaterThan(0);
  const saved = posts.find((post) => post.path === `/cv/${CV_ID}`)?.body.cv_data as typeof CV_DATA;
  expect(saved.personal_info.title).toBe("Senior Backend Developer");
  expect(unexpected).toEqual([]);
});

test("a job from the catalog fills the JD and links the analysis to it", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.getByRole("link", { name: "Việc làm", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Backend Engineer" })).toBeVisible();
  await page.getByRole("button", { name: "Xem mô tả" }).click();
  await expect(page.getByText("Join the Grab platform team.")).toBeVisible();

  await page.getByRole("link", { name: "Phân tích với CV của tôi" }).click();
  await expect(page.locator(".job-chip")).toContainText("Backend Engineer");
  await expect(page.locator(".jd-input").first()).toHaveValue(/Join the Grab platform team/);
  await expect(page.getByLabel("CV đã lưu")).toHaveValue(CV_ID);
  await page.getByRole("button", { name: "Phân tích bằng AI" }).click();
  await expect(page).toHaveURL(new RegExp(`/analysis/${ANALYSIS_ID}$`));
  expect(posts.find((post) => post.path === "/analyze")?.body).toMatchObject({ cv_id: CV_ID, job_id: JOB_ID });
  expect(unexpected).toEqual([]);
});

test("quick interview starts from a CV and JD without an analysis", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.locator(".jd-input").first().fill(JD);
  await page.getByRole("button", { name: /Luyện phỏng vấn nhanh/ }).click();
  await expect(page).toHaveURL(new RegExp(`/interview/${INTERVIEW_ID}$`));
  expect(posts.find((post) => post.path === "/interviews")?.body).toEqual({ cv_id: CV_ID, jd_text: JD, question_count: 3 });
  expect(posts.filter((post) => post.path === "/analyze")).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

test("a JD captured by the browser extension fills the analysis form", async ({ page, context }) => {
  await mockServices(context);
  await signIn(page);
  await page.evaluate((text) => sessionStorage.setItem("cvfit.jd-draft", JSON.stringify({ text, job: null })), JD);
  await page.reload();
  await expect(page.locator(".jd-input").first()).toHaveValue(JD);
  await expect(page.locator(".job-chip")).toHaveCount(0);
});

test("a CV the AI could not structure says so instead of looking complete", async ({ page, context }) => {
  await mockServices(context, { structured: false });
  await signIn(page);
  await page.goto(`/cv/${CV_ID}`);
  await expect(page.getByRole("status")).toContainText("AI chưa bóc tách được CV này");
});

test("a job catalog that is not set up explains what to run", async ({ page, context }) => {
  await mockServices(context, { jobsStatus: 503 });
  await signIn(page);
  await page.goto("/jobs");
  await expect(page.getByRole("status")).toContainText("004_job_postings.sql");
});

test("the interview page follows the dark theme and an answer can be redone", async ({ page, context }, testInfo) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.getByRole("button", { name: "Bật giao diện tối" }).click();
  await page.goto(`/interview/${INTERVIEW_ID}`);
  await expect(page.getByRole("heading", { name: "Câu trả lời đã nộp" })).toBeVisible();
  await expect(page.locator(".practice-card").first()).toHaveCSS("background-color", "rgb(30, 41, 59)");
  await page.screenshot({ path: testInfo.outputPath("interview-dark.png"), fullPage: true });

  await page.getByRole("button", { name: "↻ Trả lời lại câu này" }).click();
  const answer = page.locator(".practice-card textarea");
  await expect(answer).toHaveValue("A previous answer long enough to submit.");
  await answer.fill("A better answer with a concrete example from the project.");
  await page.getByRole("button", { name: "Nộp và nhận đánh giá" }).click();
  await expect(page.getByRole("heading", { name: "Câu trả lời đã nộp" })).toBeVisible();
  expect(posts.find((post) => post.path.endsWith("/answers"))?.body).toMatchObject({
    question_index: 0, answer_text: "A better answer with a concrete example from the project.",
  });
  expect(unexpected).toEqual([]);
});

test("the chosen theme survives a reload", async ({ page, context }) => {
  await mockServices(context);
  await signIn(page);
  await page.getByRole("button", { name: "Bật giao diện tối" }).click();
  await expect(page.locator("main.app-shell")).toHaveClass(/theme-dark/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await expect(page.locator("main.app-shell")).toHaveClass(/theme-dark/);
});

test("score weights add up to 100% when the JD has no education requirement", async ({ page, context }) => {
  await mockServices(context);
  await signIn(page);
  await page.goto(`/analysis/${ANALYSIS_ID}`);
  const rows = page.locator(".scoring-breakdown p");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Kỹ năng · trọng số 56%");
  await expect(rows.nth(1)).toContainText("Kinh nghiệm / dự án · trọng số 44%");
  await expect(rows.nth(2)).toContainText("Học vấn · trọng số 0%");
  await expect(rows.nth(2)).toContainText("JD không nêu yêu cầu");
  await expect(page.locator(".scoring-breakdown small")).toContainText("về học vấn nên 20% trọng số");
});

test("dark score breakdown stays readable", async ({ page, context }) => {
  await mockServices(context);
  await signIn(page);
  await page.getByRole("button", { name: "Bật giao diện tối" }).click();
  await page.goto(`/analysis/${ANALYSIS_ID}`);
  await expect(page.locator(".scoring-breakdown")).toHaveCSS("background-color", "rgb(23, 35, 55)");
  await expect(page.locator(".scoring-breakdown > strong")).toHaveCSS("color", "rgb(248, 250, 252)");
});

test("the printed CV shows no placeholders or empty sections", async ({ page, context }) => {
  await mockServices(context);
  await signIn(page);
  await page.goto(`/cv/${CV_ID}`);
  await expect(page.locator(".cv-paper")).toContainText("Original summary");
  await page.emulateMedia({ media: "print" });
  const paper = page.locator(".cv-paper");
  await expect(paper.getByRole("heading", { name: "Ngoại ngữ" })).toBeHidden();
  await expect(paper.getByRole("heading", { name: "Chứng chỉ" })).toBeHidden();
  await expect(paper.getByRole("heading", { name: "Kinh nghiệm" })).toBeVisible();
  await expect(paper.locator(".cv-gpa").first()).toBeHidden();
  await expect(paper.locator(".cv-tech").first()).toBeHidden();
  expect(await paper.locator(".editable:empty").evaluateAll((items) =>
    items.map((item) => getComputedStyle(item, "::before").content).filter((content) => content !== "none"))).toEqual([]);
  await expect(page.locator(".site-header")).toBeHidden();
});

test("list fields accept commas and stay in step with the CV preview", async ({ page, context }) => {
  await mockServices(context);
  await signIn(page);
  await page.goto("/create");
  const skills = page.getByPlaceholder("JavaScript, SQL, Docker").first();
  await skills.click();
  await page.keyboard.type("Node.js, React");
  await expect(skills).toHaveValue("Node.js, React");
  await expect(page.locator(".cv-paper")).toContainText("Node.js, React");

  await page.locator(".cv-paper .cv-section", { hasText: "Kỹ năng" }).locator(".editable").fill("Go, Rust");
  await expect(skills).toHaveValue("Go, Rust");
});

test("history lists CVs, reports and interview sessions", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await signIn(page);
  await page.getByRole("link", { name: "Lịch sử", exact: true }).click();
  await expect(page.getByRole("link", { name: /^CV Flow Demo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Phù hợp 75%.*CV Flow Demo → Backend Engineer · Grab/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Chất lượng 81\/100.*CV Flow Demo/ })).toHaveAttribute("href", `/cv/${CV_ID}?evaluation=${EVAL_NEW}`);
  await page.getByRole("link", { name: /Điểm 70\/100/ }).click();
  await expect(page).toHaveURL(new RegExp(`/interview/${INTERVIEW_ID}$`));
  expect(unexpected).toEqual([]);
});

for (const path of ["/", "/jobs", "/history", "/create", `/analysis/${ANALYSIS_ID}`, `/interview/${INTERVIEW_ID}`]) {
  test(`${path} fits a phone screen`, async ({ page, context }) => {
    await mockServices(context);
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
    await expect(page.locator(".site-footer")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("the report lists each experience requirement and says when the JD asks nothing about education", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto(`/analysis/${ANALYSIS_ID}`);
  const experience = page.locator(".result-card", { hasText: "Kinh nghiệm & dự án" });
  await expect(experience.locator(".requirement-list li")).toHaveCount(1);
  await expect(experience.locator(".requirement-list")).toContainText("REST APIs and PostgreSQL experience");
  await expect(experience.locator(".requirement-list")).toContainText("Chưa thấy bằng chứng trong CV");
  const education = page.locator(".result-card", { hasText: "Học vấn & bằng cấp" });
  await expect(education).toContainText("JD không nêu yêu cầu về học vấn, ngoại ngữ hay chứng chỉ");
  // The old yes/no boxes disagreed with the score when the JD had no such requirement.
  await expect(education.locator(".education-grid")).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("editing a JD picked from the catalog drops the link to that posting", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto(`/?job=${JOB_ID}`);
  await expect(page.locator(".job-chip")).toContainText("Backend Engineer");
  await page.locator(".jd-input").first().press("End");
  await page.locator(".jd-input").first().pressSequentially(" Also Kubernetes.");
  await expect(page.locator(".job-chip")).toHaveCount(0);
  await page.getByRole("button", { name: "Phân tích bằng AI" }).click();
  await expect(page).toHaveURL(new RegExp(`/analysis/${ANALYSIS_ID}$`));
  const body = posts.find((post) => post.path === "/analyze")?.body;
  expect(body?.jd_text).toMatch(/Also Kubernetes\.$/);
  expect(body).not.toHaveProperty("job_id");
  expect(unexpected).toEqual([]);
});

test("quick practice can ask five questions", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.locator(".jd-input").first().fill(JD);
  await page.getByLabel("Số câu").selectOption("5");
  await page.getByRole("button", { name: /Luyện phỏng vấn nhanh/ }).click();
  await expect(page).toHaveURL(new RegExp(`/interview/${INTERVIEW_ID}$`));
  expect(posts.find((post) => post.path === "/interviews")?.body).toMatchObject({ question_count: 5 });
  expect(unexpected).toEqual([]);
});

test("the CV page switches templates and shows earlier quality checks", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto(`/cv/${CV_ID}`);
  const quality = page.locator(".quality-section");
  await expect(quality.locator(".quality-heading > strong")).toContainText("81/100");
  await expect(quality).toContainText("↑ +7 so với lần trước");
  await expect(quality).toContainText("Newest finding");
  await quality.getByRole("button", { name: /^74\/100/ }).click();
  await expect(quality.locator(".quality-heading > strong")).toContainText("74/100");
  await expect(quality).toContainText("Older finding");

  await page.getByLabel("Mẫu").selectOption("classic");
  await expect(page.locator(".cv-paper")).toHaveClass(/cv-template-classic/);
  const lastSave = () => [...posts].reverse().find((post) => post.path === `/cv/${CV_ID}` && post.method === "PUT");
  await expect.poll(() => (lastSave()?.body.cv_data as typeof CV_DATA | undefined)?.template).toBe("classic");
  expect(unexpected).toEqual([]);
});

test("a quality check opened from history is the one shown", async ({ page, context }) => {
  await mockServices(context);
  await signIn(page);
  await page.goto(`/cv/${CV_ID}?evaluation=${EVAL_OLD}`);
  await expect(page.locator(".quality-heading > strong")).toContainText("74/100");
});

test("history pages through CVs and deletes one only after confirmation", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto("/history");
  const cvs = page.locator(".soft-card", { hasText: "CV đã lưu" });
  await cvs.getByRole("button", { name: "Tải thêm (1)" }).click();
  await expect(cvs.getByRole("link", { name: /CV cũ năm ngoái/ })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.dismiss());
  await cvs.getByRole("button", { name: "Xóa CV Flow Demo" }).click();
  expect(posts.filter((post) => post.method === "DELETE")).toHaveLength(0);

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("phiên phỏng vấn dùng CV này cũng bị xóa");
    void dialog.accept();
  });
  await cvs.getByRole("button", { name: "Xóa CV Flow Demo" }).click();
  await expect(page.getByRole("status")).toContainText("Đã xóa “CV Flow Demo”");
  expect(posts.filter((post) => post.method === "DELETE").map((post) => post.path)).toEqual([`/cv/${CV_ID}`]);
  expect(unexpected).toEqual([]);
});

test("an interviewer follow-up can be answered and the earlier attempt stays visible", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context, { interview: FOLLOW_UP_INTERVIEW });
  await signIn(page);
  await page.goto(`/interview/${INTERVIEW_ID}`);
  await expect(page.getByText("so với lần trước: 50 → 70")).toBeVisible();
  await page.getByText("Các lần trả lời trước (1)").click();
  await expect(page.getByText("An earlier, weaker answer without an example.")).toBeVisible();

  const followUp = page.getByRole("region", { name: "Câu hỏi nối tiếp" });
  await expect(followUp).toContainText(FOLLOW_UP_QUESTION);
  await followUp.getByLabel("Câu trả lời cho câu hỏi nối tiếp").fill("I measured p95 latency with k6 before and after.");
  await followUp.getByRole("button", { name: "Nộp câu trả lời nối tiếp" }).click();
  await expect(page.getByRole("status")).toContainText("Đã lưu đánh giá câu trả lời nối tiếp");
  expect(posts.find((post) => post.path.endsWith("/answers/0/follow-up"))?.body).toEqual({
    answer_text: "I measured p95 latency with k6 before and after.",
  });
  expect(unexpected).toEqual([]);
});

test("admin overview is hidden from regular users and visible to verified admins", async ({ page, context }) => {
  await mockServices(context, { isAdmin: false });
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quản trị" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("status")).toContainText("Chỉ tài khoản quản trị (Admin) mới có quyền truy cập");

  await mockServices(context, { isAdmin: true });
  await page.goto("/");
  const adminLink = page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quản trị" });
  await expect(adminLink).toBeVisible();
  await adminLink.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Thống kê tổng quan hệ thống" })).toBeVisible();
  await expect(page.getByText("87.000đ")).toBeVisible();
  await expect(page.getByText("Quản trị viên (1/3)")).toBeVisible();
});
