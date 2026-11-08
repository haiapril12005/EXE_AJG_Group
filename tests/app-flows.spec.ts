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
const NEW_EMAIL = "moi@example.com";
const OLDER_USER_ID = "00000000-0000-4000-8000-000000000010";
const TAKEN_EMAIL = "taken@example.com";
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

type Options = { jobsStatus?: number; savedCvs?: boolean; structured?: boolean; interview?: Interview; isAdmin?: boolean; chatStatus?: number; cvData?: typeof CV_DATA };

async function mockServices(context: BrowserContext, { jobsStatus = 200, savedCvs = true, structured = true, interview = INTERVIEW, isAdmin = false, chatStatus = 200, cvData = CV_DATA }: Options = {}) {
  const posts: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  let savedJobIds: string[] = [];
  const verifications: string[] = [];
  let authUser: Record<string, unknown> = USER;
  let accountEmail = EMAIL;
  let accountAvatar: string | null = null;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/auth/v1/")) {
      if (request.method() === "OPTIONS") return reply(route, 200, {});
      if (url.pathname === "/auth/v1/token") return reply(route, 200, { ...session(), user: authUser });
      if (url.pathname === "/auth/v1/user") {
        const email = request.method() === "PUT" ? (request.postDataJSON() as { email?: string }).email : undefined;
        if (email === TAKEN_EMAIL) return reply(route, 422, { code: "email_exists", error_code: "email_exists", msg: "A user with this email address has already been registered" });
        if (email) authUser = { ...authUser, new_email: email };
        return reply(route, 200, authUser);
      }
      if (url.pathname === "/auth/v1/verify") {
        const { email, token } = request.postDataJSON() as { email: string; token: string };
        verifications.push(`${email}:${token}`);
        if (email === EMAIL && token === "111111") return reply(route, 200, { msg: "Confirmation link accepted. Please proceed to confirm link sent to the other email" });
        if (email === NEW_EMAIL && token === "222222") {
          authUser = { ...USER, email: NEW_EMAIL };
          return reply(route, 200, { ...session(), user: authUser });
        }
        return reply(route, 403, { code: "otp_expired", error_code: "otp_expired", msg: "Token has expired or is invalid" });
      }
      return reply(route, 200, {});
    }
    if (url.port === "4000" && url.pathname.startsWith("/api/")) {
      if (request.method() === "OPTIONS") return reply(route, 200, {});
      const path = url.pathname.slice("/api".length);
      const method = request.method();
      if (method !== "GET") posts.push({ method, path, body: request.postDataJSON() ?? {} });
      const page = url.searchParams.get("page") ?? "1";
      if (path === "/user/me") {
        if (method === "PUT") {
          const body = request.postDataJSON() ?? {};
          return reply(route, 200, {
            user: {
              id: USER_ID,
              email: typeof body.email === "string" ? body.email : EMAIL,
              full_name: typeof body.full_name === "string" ? body.full_name : "Flow Demo",
              phone: typeof body.phone === "string" ? body.phone : "0912345678",
              credits: 0,
              is_admin: isAdmin,
              payments_enabled: false,
            },
            message: "Đã cập nhật thông tin hồ sơ thành công.",
          });
        }
        return reply(route, 200, {
          user: { id: USER_ID, email: accountEmail, full_name: "Flow Demo", phone: "0912345678", credits: 0, is_admin: isAdmin, avatar: accountAvatar, payments_enabled: false },
        });
      }
      if (path === "/user/avatar") {
        accountAvatar = String((request.postDataJSON() as { avatar?: string }).avatar ?? "") || null;
        return reply(route, 200, { user: { id: USER_ID, email: accountEmail, full_name: "Flow Demo", credits: 0, is_admin: isAdmin, avatar: accountAvatar, payments_enabled: false } });
      }
      if (path === "/user/email/sync") {
        accountEmail = String(authUser.email);
        return reply(route, 200, { user: { id: USER_ID, email: accountEmail, full_name: "Flow Demo", credits: 0, is_admin: isAdmin, payments_enabled: false } });
      }
      if (path === "/chat") {
        return chatStatus === 200
          ? reply(route, 200, { reply: "Bấm avatar ở góc trên rồi chọn Hồ sơ cá nhân." })
          : reply(route, chatStatus, { error: "Bạn gửi tin nhắn hơi nhanh. Vui lòng chờ một phút rồi thử lại." });
      }
      if (path === "/user/password" && method === "PUT") {
        return reply(route, 200, { updated: true, message: "Đã đổi mật khẩu thành công." });
      }
      if (path === "/admin/users") {
        if (!isAdmin) return reply(route, 403, { error: "Chỉ tài khoản quản trị (Admin) mới có quyền truy cập trang thống kê này." });
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const all = [
          { id: USER_ID, user_code: "81047992", email: EMAIL, full_name: "Flow Demo", credits: 0, is_admin: true, created_at: "2026-01-01T00:00:00.000Z" },
          { id: OLDER_USER_ID, user_code: "12345678", email: "older@example.com", full_name: "Người Dùng Cũ", credits: 1, is_admin: false, created_at: "2025-01-01T00:00:00.000Z" },
        ];
        const users = all.filter((user) => !q || [user.email, user.full_name.toLowerCase(), user.user_code].some((value) => value.includes(q)));
        return reply(route, 200, { users, total: users.length, page: 1, page_size: 20 });
      }
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
        return reply(route, 200, method === "GET" ? { cv_id: CV_ID, cv_data: cvData, structured } : { saved: true });
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
        if (jobsStatus !== 200) {
          return reply(route, jobsStatus, { error: "Kho việc làm chưa sẵn sàng. Hãy chạy migration 004_job_postings.sql rồi chạy npm run jobs:sync." });
        }
        const onlySaved = url.searchParams.get("saved") === "1";
        const jobs = onlySaved ? [JOB].filter((j) => savedJobIds.includes(j.id)) : [JOB];
        return reply(route, 200, { jobs, total: jobs.length, page: 1, page_size: 20, saved_ids: savedJobIds });
      }
      if (path === `/jobs/${JOB_ID}/save`) {
        if (method === "POST") {
          savedJobIds = [JOB_ID, ...savedJobIds.filter((id) => id !== JOB_ID)];
          return reply(route, 200, { saved: true, saved_ids: savedJobIds });
        }
        if (method === "DELETE") {
          savedJobIds = savedJobIds.filter((id) => id !== JOB_ID);
          return reply(route, 200, { saved: false, saved_ids: savedJobIds });
        }
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
  return { posts, unexpected, verifications };
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("button", { name: "Menu tài khoản" })).toBeVisible();
  // Signing in opens the job list; these tests start from the analysis page.
  await expect(page).toHaveURL(/\/jobs$/);
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Phân tích" }).click();
  await expect(page).toHaveURL(/\/analyze$/);
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

  await page.getByRole("link", { name: "← Về trang phân tích" }).click();
  await expect(page).toHaveURL(/\/analyze$/);
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
  await expect(page.locator(".practice-card").first()).toHaveCSS("background-color", "rgb(18, 18, 18)");
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
  await expect(page.getByRole("button", { name: "Menu tài khoản" })).toBeVisible();
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
  await expect(page.locator(".scoring-breakdown")).toHaveCSS("background-color", "rgb(10, 10, 10)");
  await expect(page.locator(".scoring-breakdown > strong")).toHaveCSS("color", "rgb(250, 250, 250)");
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

for (const path of ["/analyze", "/jobs", "/history", "/create", "/profile", `/analysis/${ANALYSIS_ID}`, `/interview/${INTERVIEW_ID}`]) {
  test(`${path} fits a phone screen`, async ({ page, context }) => {
    await mockServices(context);
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Menu tài khoản" })).toBeVisible();
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

test("account menu displays User ID under the name, opens profile to edit info & password, and places sign-out at the bottom", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);

  const accountTrigger = page.getByRole("button", { name: "Menu tài khoản" });
  await expect(accountTrigger).toContainText("Flow Demo");
  await expect(accountTrigger.locator(".profile-uid")).toHaveText(/^ID: \d{8}$/);

  await accountTrigger.click();
  const dropdown = page.getByRole("menu", { name: "Tùy chọn tài khoản" });
  await expect(dropdown).toBeVisible();
  await expect(dropdown.locator(".account-dropdown-uid")).toHaveText(/^ID: \d{8}$/);
  await expect(dropdown.getByRole("menuitem", { name: "Đăng xuất" })).toBeVisible();

  await dropdown.getByRole("menuitem", { name: "Hồ sơ cá nhân" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.locator(".profile-id-code")).toHaveText(/^\d{8}$/);

  await page.getByLabel("Họ và tên").fill("Phạm Hải");
  await page.getByLabel("Số điện thoại").fill("0987654321");
  await expect(page.getByLabel("Địa chỉ Email")).toBeDisabled();
  await page.getByRole("button", { name: "Lưu thông tin cá nhân" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã cập nhật thông tin hồ sơ thành công" })).toBeVisible();
  expect(posts.find((p) => p.path === "/user/me" && p.method === "PUT")?.body).toEqual({
    full_name: "Phạm Hải",
    phone: "0987654321",
  });

  await page.getByLabel("Mật khẩu hiện tại", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill("NewStrongPass!2026");
  await page.getByLabel("Nhập lại mật khẩu mới", { exact: true }).fill("NewStrongPass!2026");
  await page.getByRole("button", { name: "Đổi mật khẩu", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã đổi mật khẩu thành công" })).toBeVisible();
  expect(posts.find((p) => p.path === "/user/password" && p.method === "PUT")?.body).toEqual({
    current_password: PASSWORD,
    new_password: "NewStrongPass!2026",
  });

  await expect(page.getByRole("button", { name: "↪ Đăng xuất khỏi tài khoản" })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("a job saved for later stays in the user's saved list across reloads and re-logins", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await signIn(page);
  await page.getByRole("link", { name: "Việc làm", exact: true }).click();

  const saveBtn = page.getByRole("button", { name: "☆ Lưu xem sau" });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();
  await expect(page.getByRole("button", { name: "★ Đã lưu" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Xem sau · Đã lưu \(1\)/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "★ Đã lưu" })).toBeVisible();
  await page.getByRole("tab", { name: /Xem sau · Đã lưu \(1\)/ }).click();
  await expect(page.getByText("1 việc làm đã lưu để xem sau")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backend Engineer" })).toBeVisible();

  await page.getByRole("button", { name: "★ Đã lưu" }).click();
  await expect(page.getByText("0 việc làm đã lưu để xem sau")).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("on a phone the avatar opens the account menu with profile and sign-out", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole("button", { name: "Menu tài khoản" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Tùy chọn tài khoản" });
  await expect(menu).toBeInViewport({ ratio: 1 });
  await expect(menu.getByRole("menuitem", { name: "Hồ sơ cá nhân" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Đăng xuất" }).click();
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("the profile no longer changes email directly; the save sends only name and phone", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto("/profile");
  await expect(page.getByLabel("Địa chỉ Email")).toBeDisabled();
  await page.getByRole("button", { name: "Lưu thông tin cá nhân" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã cập nhật" })).toBeVisible();
  expect(posts.find((post) => post.path === "/user/me" && post.method === "PUT")?.body).not.toHaveProperty("email");
  expect(unexpected).toEqual([]);
});

test("changing email needs the password and both codes, then updates the account email", async ({ page, context }) => {
  const { posts, verifications, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto("/profile");
  await page.getByLabel("Email mới").fill(NEW_EMAIL);
  await page.getByLabel("Mật khẩu để xác nhận").fill(PASSWORD);
  await page.getByRole("button", { name: "Gửi mã xác nhận" }).click();
  await expect(page.getByRole("heading", { name: "Xác nhận đổi email" })).toBeVisible();
  await expect(page.getByText(`Đang chờ xác nhận email mới: ${NEW_EMAIL}`)).toBeVisible();

  // A wrong code keeps the form open with guidance.
  await page.getByLabel(/Mã gửi tới email mới/).fill("999999");
  await page.getByRole("button", { name: "Xác nhận đổi email" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "hết hạn" })).toBeVisible();

  // The first code alone does not finish the change.
  await page.getByLabel(/Mã gửi tới email mới/).fill("");
  await page.getByLabel(/Mã gửi tới email hiện tại/).fill("111111");
  await page.getByRole("button", { name: "Xác nhận đổi email" }).click();
  await expect(page.getByText("Hãy nhập nốt mã")).toBeVisible();

  await page.getByLabel(/Mã gửi tới email mới/).fill("222222");
  await page.getByRole("button", { name: "Xác nhận đổi email" }).click();
  await expect(page.getByText(`Từ nay hãy đăng nhập bằng ${NEW_EMAIL}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Đổi email", exact: true })).toBeVisible();
  await expect(page.getByLabel("Địa chỉ Email")).toHaveValue(NEW_EMAIL);
  expect(verifications).toEqual([`${NEW_EMAIL}:999999`, `${EMAIL}:111111`, `${NEW_EMAIL}:222222`]);
  expect(posts.some((post) => post.path === "/user/email/sync")).toBe(true);
  expect(unexpected).toEqual([]);
});

test("an email already in use or equal to the current one is refused with its own reason", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto("/profile");
  await page.getByLabel("Mật khẩu để xác nhận").fill(PASSWORD);
  await page.getByLabel("Email mới").fill(EMAIL);
  await page.getByRole("button", { name: "Gửi mã xác nhận" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "phải khác email hiện tại" })).toBeVisible();

  await page.getByLabel("Email mới").fill(TAKEN_EMAIL);
  await page.getByRole("button", { name: "Gửi mã xác nhận" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "đã được dùng" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Xác nhận đổi email" })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("common questions in the help chat are answered on the spot without calling the AI", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.getByRole("button", { name: "Mở hỗ trợ sử dụng" }).click();
  await page.getByRole("button", { name: "Đăng xuất ở đâu?" }).click();
  await expect(page.getByRole("log")).toContainText("Đăng xuất");
  expect(posts.filter((post) => post.path === "/chat")).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

test("a typed question goes to the AI with only the page section, and the chat is cleared on sign-out", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto(`/analysis/${ANALYSIS_ID}`);
  await page.getByRole("button", { name: "Mở hỗ trợ sử dụng" }).click();
  await page.getByLabel("Câu hỏi của bạn").fill("Đổi số điện thoại ở đâu?");
  await page.getByLabel("Câu hỏi của bạn").press("Enter");
  await expect(page.getByRole("log")).toContainText("Hồ sơ cá nhân");
  const sent = posts.find((post) => post.path === "/chat");
  expect(sent?.body).toMatchObject({ page: "/analysis", messages: [{ role: "user", content: "Đổi số điện thoại ở đâu?" }] });
  expect(JSON.stringify(sent?.body)).not.toContain(ANALYSIS_ID);

  await page.reload();
  await page.getByRole("button", { name: "Mở hỗ trợ sử dụng" }).click();
  await expect(page.getByRole("log")).toContainText("Đổi số điện thoại ở đâu?");
  await page.getByRole("button", { name: "Đóng hỗ trợ sử dụng" }).click();
  await page.getByRole("button", { name: "Menu tài khoản" }).click();
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click();
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `cvfit.chat.${USER_ID}`)).toBeNull();
  expect(unexpected).toEqual([]);
});

test("a failed chat message returns to the box with the reason and the common questions", async ({ page, context }) => {
  const { unexpected } = await mockServices(context, { chatStatus: 429 });
  await signIn(page);
  await page.getByRole("button", { name: "Mở hỗ trợ sử dụng" }).click();
  await page.getByLabel("Câu hỏi của bạn").fill("Câu hỏi của tôi");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "hơi nhanh" })).toBeVisible();
  await expect(page.getByLabel("Câu hỏi của bạn")).toHaveValue("Câu hỏi của tôi");
  await expect(page.getByRole("button", { name: "Làm sao để lưu JD xem sau?" })).toBeVisible();
  expect(unexpected).toEqual([]);
});

for (const path of ["/jobs", "/profile"]) {
  test(`${path} with the help chat open fits a phone screen`, async ({ page, context }) => {
    await mockServices(context);
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(path);
    await page.getByRole("button", { name: "Mở hỗ trợ sử dụng" }).click();
    await expect(page.getByRole("region", { name: "Hỗ trợ sử dụng" })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("the admin user list is searched by the server, so older accounts can be found", async ({ page, context }) => {
  const { unexpected } = await mockServices(context, { isAdmin: true });
  await signIn(page);
  await page.goto("/admin");
  const list = page.getByRole("region", { name: "Danh sách người dùng" });
  await expect(list).toContainText("Danh sách người dùng hệ thống (2)");
  await expect(list).toContainText("older@example.com");

  const searched = page.waitForRequest((request) => request.url().includes("/api/admin/users") && request.url().includes("q=12345678"));
  await page.getByLabel("Tìm người dùng").fill("12345678");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await searched;
  await expect(list).toContainText("Kết quả tìm “12345678” (1)");
  await expect(list).toContainText("Người Dùng Cũ");
  await expect(list).not.toContainText("Flow Demo");

  await page.getByLabel("Tìm người dùng").fill("khong-co-ai");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await expect(list).toContainText("Không tìm thấy người dùng khớp “khong-co-ai”.");
  expect(unexpected).toEqual([]);
});

test("/admin fits a phone screen", async ({ page, context }) => {
  await mockServices(context, { isAdmin: true });
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await expect(page.getByLabel("Tìm người dùng")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the job list is the home page: / and the logo open /jobs, and an old job link still opens the analysis form", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link").first()).toHaveText("Việc làm");

  await page.goto("/");
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByRole("heading", { name: "Chọn công việc bạn muốn ứng tuyển" })).toBeVisible();

  await nav.getByRole("link", { name: "Phân tích" }).click();
  await expect(page).toHaveURL(/\/analyze$/);
  await page.getByRole("link", { name: /JOB READY/ }).click();
  await expect(page).toHaveURL(/\/jobs$/);

  await page.goto(`/?job=${JOB_ID}`);
  await expect(page).toHaveURL(/\/analyze$/);
  await expect(page.getByText("Đang dùng JD:")).toContainText("Backend Engineer");
  expect(unexpected).toEqual([]);
});

test("dark mode is black, including the page behind the app", async ({ page, context }, testInfo) => {
  await mockServices(context);
  await signIn(page);
  await page.getByRole("button", { name: "Bật giao diện tối" }).click();
  await page.goto("/jobs");
  await expect(page.locator("main.app-shell")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator(".job-card").first()).toHaveCSS("background-color", "rgb(18, 18, 18)");
  await page.screenshot({ path: testInfo.outputPath("jobs-dark.png"), fullPage: true });
  await page.goto("/analyze");
  await expect(page.getByRole("heading", { name: /Tối Ưu Hóa Hồ Sơ/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("analyze-dark.png"), fullPage: true });
});

const RICH_CV = {
  ...CV_DATA,
  personal_info: { name: "Nguyễn Minh Anh", email: "minhanh@example.com", phone: "0912 345 678", title: "Backend Developer" },
  summary: "Lập trình viên backend 2 năm kinh nghiệm với Node.js và PostgreSQL, quan tâm tới hiệu năng và chất lượng mã.",
  education: [{ school: "Đại học FPT", major: "Kỹ thuật phần mềm", gpa: "3.4/4", start_date: "09/2020", end_date: "06/2024" }],
  experience: [
    { company: "Công ty ABC", role: "Backend Developer", start_date: "07/2024", end_date: "Hiện tại", description: "- Xây dựng REST API cho hệ thống đặt hàng\n- Tối ưu truy vấn PostgreSQL" },
    { company: "Startup XYZ", role: "Thực tập sinh", start_date: "01/2024", end_date: "06/2024", description: "- Viết test tự động cho dịch vụ thanh toán" },
  ],
  projects: [{ name: "Job Ready", technologies: ["Next.js", "Express", "Supabase"], description: "- Đối chiếu CV với JD bằng AI" }],
  skills: ["TypeScript", "Node.js", "PostgreSQL", "Docker"],
  languages: [{ name: "Tiếng Anh", level: "IELTS 7.0" }],
  certificates: [{ name: "AWS Cloud Practitioner", issuer: "Amazon", year: "2025" }],
  links: [{ label: "GitHub", url: "github.com/minhanh" }],
};

test("the template library offers seventeen templates in groups and a new one is applied and saved", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto("/create");
  await expect(page.locator(".template-card")).toHaveCount(17);
  await expect(page.locator(".template-count")).toHaveText("17 mẫu");
  await page.getByRole("button", { name: "Chuyên nghiệp (8)" }).click();
  await expect(page.locator(".template-card")).toHaveCount(8);
  await expect(page.getByRole("button", { name: /^Corporate 2 cột/ })).toBeVisible();
  await page.locator(".template-picker").screenshot({ path: test.info().outputPath("picker-professional.png") });
  await page.getByRole("button", { name: "Tất cả (17)" }).click();
  await page.getByRole("button", { name: /^Tech/ }).click();
  await expect(page.locator(".cv-paper")).toHaveClass(/cv-template-tech/);
  await page.locator(".cv-head h1 .editable").fill("Nguyễn Minh Anh");
  await expect.poll(() => posts.find((post) => post.path === "/cv/create")?.body.cv_data as { template?: string } | undefined)
    .toMatchObject({ template: "tech" });
  expect(unexpected).toEqual([]);
});

test("each new template keeps a full-bleed header inside the paper, on screen and in print", async ({ page, context }, testInfo) => {
  await mockServices(context, { cvData: RICH_CV });
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/cv/${CV_ID}`);
  const select = page.getByLabel("Mẫu");
  for (const template of ["elegant", "tech", "timeline", "bold", "pastel", "ats", "executive", "creative", "corporate", "consultant", "formal", "monogram", "slate"]) {
    await select.selectOption(template);
    const paper = page.locator(".cv-paper");
    await expect(paper).toHaveClass(new RegExp(`cv-template-${template}`));
    const [paperBox, headBox] = [await paper.boundingBox(), await page.locator(".cv-head").boundingBox()];
    expect(headBox!.x).toBeGreaterThanOrEqual(paperBox!.x - 0.5);
    expect(headBox!.x + headBox!.width).toBeLessThanOrEqual(paperBox!.x + paperBox!.width + 0.5);
    await paper.screenshot({ path: testInfo.outputPath(`template-${template}.png`) });
  }
  // A narrower screen uses smaller paper padding; the Executive and Tech headers must follow it.
  await page.setViewportSize({ width: 900, height: 1000 });
  for (const template of ["executive", "tech"]) {
    await select.selectOption(template);
    const [paperBox, headBox] = [await page.locator(".cv-paper").boundingBox(), await page.locator(".cv-head").boundingBox()];
    expect(headBox!.x).toBeGreaterThanOrEqual(paperBox!.x - 0.5);
    expect(headBox!.x + headBox!.width).toBeLessThanOrEqual(paperBox!.x + paperBox!.width + 0.5);
  }
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: testInfo.outputPath("template-tech-print.png"), fullPage: true });
});

test("professional templates lead with experience and put skills in a column beside it", async ({ page, context }) => {
  await mockServices(context, { cvData: RICH_CV });
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/cv/${CV_ID}`);
  const select = page.getByLabel("Mẫu");
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
  for (const [template, side] of [["corporate", "left"], ["consultant", "right"], ["monogram", "right"], ["slate", "left"]] as const) {
    await select.selectOption(template);
    const [experience, education, skills] = [await box(".cv-sec-experience"), await box(".cv-sec-education"), await box(".cv-sec-skills")];
    expect(experience.y, `${template}: experience above education`).toBeLessThan(education.y);
    if (side === "left") expect(skills.x + skills.width, `${template}: skills on the left`).toBeLessThanOrEqual(experience.x);
    else expect(skills.x, `${template}: skills on the right`).toBeGreaterThanOrEqual(experience.x + experience.width);
    // The side column starts near the top instead of below the whole main column.
    expect(skills.y, `${template}: skills beside the main column`).toBeLessThan(education.y);
  }
  await select.selectOption("monogram");
  await expect(page.locator(".cv-initials")).toHaveText("NA");
  await select.selectOption("modern");
  await expect(page.locator(".cv-initials")).toBeHidden();
  // A single-column template keeps the original order.
  expect((await box(".cv-sec-education")).y).toBeLessThan((await box(".cv-sec-experience")).y);
});

// A real 1x1 PNG, enough for the browser to decode, crop and compress.
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("a CV photo is cropped to 3x4, saved with the CV, fits every header style and can be removed", async ({ page, context }, testInfo) => {
  const { posts, unexpected } = await mockServices(context, { cvData: RICH_CV });
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/cv/${CV_ID}`);
  await expect(page.getByRole("button", { name: "＋ Ảnh 3x4" })).toBeVisible();
  await page.getByLabel("Chọn ảnh 3x4 cho CV").setInputFiles({ name: "chan-dung.png", mimeType: "image/png", buffer: PNG_1X1 });
  const photo = page.locator("img.cv-photo");
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([300, 400]);
  await expect.poll(() => (posts.filter((post) => post.path === `/cv/${CV_ID}`).at(-1)?.body.cv_data as { photo?: string } | undefined)?.photo ?? "")
    .toMatch(/^data:image\/jpeg;base64,/);

  const select = page.getByLabel("Mẫu");
  for (const template of ["modern", "classic", "executive", "corporate", "monogram", "slate"]) {
    await select.selectOption(template);
    const [paperBox, photoBox] = [(await page.locator(".cv-paper").boundingBox())!, (await photo.boundingBox())!];
    expect(photoBox.x, template).toBeGreaterThanOrEqual(paperBox.x);
    expect(photoBox.x + photoBox.width, template).toBeLessThanOrEqual(paperBox.x + paperBox.width);
    expect(photoBox.height / photoBox.width, template).toBeCloseTo(4 / 3, 1);
    await page.locator(".cv-head").screenshot({ path: testInfo.outputPath(`photo-${template}.png`) });
  }
  await expect(page.locator(".cv-initials")).toBeHidden();

  await page.getByRole("button", { name: "Xóa ảnh 3x4" }).click();
  await expect(photo).toHaveCount(0);
  await expect.poll(() => (posts.filter((post) => post.path === `/cv/${CV_ID}`).at(-1)?.body.cv_data as { photo?: string } | undefined)?.photo)
    .toBe("");
  expect(unexpected).toEqual([]);
});

test("a file that is not a JPG, PNG or WebP picture is refused with a reason", async ({ page, context }) => {
  const { unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto(`/cv/${CV_ID}`);
  await page.getByLabel("Chọn ảnh 3x4 cho CV").setInputFiles({ name: "anh.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.getByRole("alert").filter({ hasText: "Chỉ nhận ảnh JPG, PNG hoặc WebP" })).toBeVisible();
  await expect(page.locator("img.cv-photo")).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("a profile picture is cropped square, saved, shown in the header and can be removed", async ({ page, context }) => {
  const { posts, unexpected } = await mockServices(context);
  await signIn(page);
  await page.goto("/profile");
  await page.getByLabel("Chọn ảnh đại diện").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(page.getByRole("status").filter({ hasText: "Đã cập nhật ảnh đại diện" })).toBeVisible();
  const saved = posts.find((post) => post.path === "/user/avatar")?.body.avatar as string;
  expect(saved).toMatch(/^data:image\/jpeg;base64,/);
  const profilePicture = page.getByRole("img", { name: "Ảnh đại diện" });
  expect(await profilePicture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([256, 256]);
  await expect(page.locator(".account-trigger img.avatar-photo")).toBeVisible();

  await page.getByRole("button", { name: "Xóa", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã xóa ảnh đại diện" })).toBeVisible();
  await expect(page.locator(".account-trigger img.avatar-photo")).toHaveCount(0);
  await expect(page.locator(".account-trigger .avatar")).toHaveText("F");
  expect(unexpected).toEqual([]);
});
