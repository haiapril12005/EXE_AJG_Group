import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";

const STORAGE_KEY = "cvfit.pending-email-verification";
const EMAIL = "demo@example.com";
const PASSWORD = "DemoPassword!2026";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const CV_ID = "00000000-0000-4000-8000-000000000002";
const USER = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: EMAIL,
  created_at: "2026-01-01T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "OTP Demo" },
  identities: [{ id: USER_ID, user_id: USER_ID, identity_id: USER_ID, provider: "email" }],
};

const ANALYSIS = {
  analysis_id: "00000000-0000-4000-8000-000000000003",
  rci_score: 75,
  layer_1_skills: { matched: ["TypeScript"], missing: [], evidence: [] },
  layer_2_projects: [],
  layer_3_education: { major_matched: false, english_matched: false, notes: "No evidence", evidence: [] },
  layer_4_mock: ["Question one?", "Question two?", "Question three?"],
  is_premium_unlocked: true,
  credits_remaining: null,
};

type MockResponse = { status: number; body: unknown };
type RecordedRequest = { path: string; body: Record<string, unknown> };
type AuthMocks = {
  signup?: MockResponse;
  login?: MockResponse;
  resend?: MockResponse;
  recover?: MockResponse;
  /** Answers to password updates, in order; later updates reuse the last one. */
  updateUser?: MockResponse[];
};

function authError(code: string, status = 400): MockResponse {
  return { status, body: { code, error_code: code, msg: "Private provider diagnostic" } };
}

function confirmedSession() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sub: USER_ID, aud: "authenticated", role: "authenticated", email: EMAIL,
      iat: issuedAt, exp: issuedAt + 3600,
    })}.dGVzdC1zaWduYXR1cmU`,
    refresh_token: "mock-refresh-token-not-valid-outside-this-test",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: issuedAt + 3600,
    user: { ...USER, email_confirmed_at: "2026-01-01T00:00:00.000Z" },
  };
}

async function reply(route: Route, response: MockResponse) {
  await route.fulfill({
    status: response.status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "x-supabase-api-version": "2024-01-01",
    },
    body: JSON.stringify(response.body),
  });
}

/** Every Auth/API request is intercepted. Unrelated external requests are blocked. */
async function mockServices(context: BrowserContext, options: AuthMocks = {}) {
  const calls: RecordedRequest[] = [];
  const apiCalls: RecordedRequest[] = [];
  const unexpected: string[] = [];
  let updates = 0;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/auth/v1/")) {
      if (request.method() === "OPTIONS") return reply(route, { status: 200, body: {} });
      const body = request.postDataJSON() as Record<string, unknown> | null;
      calls.push({ path: url.pathname, body: body ?? {} });
      switch (url.pathname) {
        case "/auth/v1/signup":
          return reply(route, options.signup ?? { status: 200, body: USER });
        case "/auth/v1/token":
          return reply(route, options.login ?? authError("email_not_confirmed"));
        case "/auth/v1/resend":
          return reply(route, options.resend ?? { status: 200, body: {} });
        case "/auth/v1/recover":
          return reply(route, options.recover ?? { status: 200, body: {} });
        case "/auth/v1/verify":
          return reply(route, body?.token === "000123"
            ? { status: 200, body: confirmedSession() }
            : authError("otp_expired", 403));
        case "/auth/v1/user":
          if (request.method() === "PUT") {
            const answers = options.updateUser ?? [{ status: 200, body: USER }];
            return reply(route, answers[Math.min(updates++, answers.length - 1)]);
          }
          return reply(route, { status: 200, body: USER });
        case "/auth/v1/logout":
          return reply(route, { status: 200, body: {} });
        default:
          unexpected.push(request.url());
          return reply(route, authError("unexpected_test_auth_request"));
      }
    }

    if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "4000" && url.pathname.startsWith("/api/")) {
      if (request.method() === "OPTIONS") return reply(route, { status: 200, body: {} });
      apiCalls.push({ path: url.pathname, body: request.headers()["content-type"]?.includes("application/json")
        ? request.postDataJSON() as Record<string, unknown> ?? {} : {} });
      switch (url.pathname) {
        case "/api/user/me":
          return reply(route, { status: 200, body: { user: {
            id: USER_ID, email: EMAIL, full_name: "OTP Demo", credits: 0, payments_enabled: false,
          } } });
        case "/api/cv":
          return reply(route, { status: 200, body: { cvs: [] } });
        case "/api/jobs":
          return reply(route, { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 20 } });
        case "/api/analyses":
          return reply(route, { status: 200, body: { analyses: [] } });
        case "/api/cv/upload":
          return reply(route, { status: 201, body: { cv_id: CV_ID } });
        case `/api/cv/${CV_ID}`:
          return reply(route, { status: 200, body: { cv_id: CV_ID, cv_data: {
            template: "modern",
            personal_info: { name: "OTP Demo", email: "", phone: "", title: "Backend Developer" },
            summary: "Built REST APIs with TypeScript.",
            education: [], experience: [], projects: [], skills: ["TypeScript"],
            languages: [], certificates: [], links: [],
          } } });
        case `/api/cv/${CV_ID}/evaluations`:
          return reply(route, { status: 200, body: { evaluations: [] } });
        case "/api/analyze":
          return reply(route, { status: 200, body: ANALYSIS });
        case `/api/analyses/${ANALYSIS.analysis_id}`:
          return reply(route, { status: 200, body: { analysis: { ...ANALYSIS, cv_id: CV_ID, jd_text: "Saved JD text" } } });
        default:
          unexpected.push(request.url());
          return reply(route, { status: 500, body: { error: "Unmocked API request" } });
      }
    }

    if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "3100") {
      return route.continue();
    }
    // The app imports Google Fonts; use its CSS fallback without making a network call.
    if (url.hostname === "fonts.googleapis.com") {
      return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    }
    unexpected.push(request.url());
    return route.abort("blockedbyclient");
  });
  return { calls, apiCalls, unexpected };
}

async function openSignup(page: Page, email = EMAIL) {
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await page.getByLabel("Họ và tên").fill("OTP Demo");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
}

async function submitSignup(page: Page) {
  await page.getByRole("button", { name: "Đăng ký và nhận mã OTP", exact: true }).click();
}

async function pendingStorage(page: Page) {
  return page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY);
}

test("signup verifies an entered OTP, rejects expired code, then requires a password login", async ({ page, context }, testInfo) => {
  const { calls, unexpected } = await mockServices(context, { login: { status: 200, body: confirmedSession() } });
  await openSignup(page, "Demo@EXAMPLE.COM");
  await submitSignup(page);
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("otp-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("otp-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(calls.find((call) => call.path.endsWith("/signup"))?.body).toMatchObject({
    email: EMAIL, password: PASSWORD, data: { full_name: "OTP Demo" },
  });

  const otp = page.getByLabel("Mã xác nhận OTP");
  await otp.fill("999999");
  await page.getByRole("button", { name: "Xác nhận mã OTP" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("không đúng hoặc đã hết hạn");
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);

  await otp.fill("000123");
  await page.getByRole("button", { name: "Xác nhận mã OTP" }).click();
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Email đã được xác nhận");
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(EMAIL);
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByText("OTP Demo", { exact: true })).toBeVisible();
  expect(calls.filter((call) => call.path.endsWith("/verify")).map((call) => ({
    email: call.body.email, token: call.body.token, type: call.body.type,
  }))).toEqual([
    { email: EMAIL, token: "999999", type: "email" },
    { email: EMAIL, token: "000123", type: "email" },
  ]);
  expect(await pendingStorage(page)).toBeNull();
  expect(unexpected).toEqual([]);
});

test("resend cooldown survives reload without persisting password or OTP", async ({ page, context }) => {
  const { calls, unexpected } = await mockServices(context);
  await page.clock.install();
  await openSignup(page);
  await submitSignup(page);
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await page.getByLabel("Mã xác nhận OTP").fill("987654");
  const saved = await pendingStorage(page);
  expect(Object.keys(JSON.parse(saved!)).sort()).toEqual(["email", "requestedAt", "resendAvailableAt"]);
  const allStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(allStorage).not.toContain(PASSWORD);
  expect(allStorage).not.toContain("987654");
  await expect(page.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await expect(page.getByLabel("Mã xác nhận OTP")).toHaveValue("");
  expect(await pendingStorage(page)).toBe(saved);
  await expect(page.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();
  expect(calls.filter((call) => call.path.endsWith("/resend"))).toHaveLength(0);

  await page.clock.fastForward(61_000);
  await page.getByRole("button", { name: "Gửi lại mã", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Đã yêu cầu gửi lại mã");
  await expect(page.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();
  expect(calls.filter((call) => call.path.endsWith("/resend"))).toHaveLength(1);
  expect(calls.find((call) => call.path.endsWith("/resend"))?.body).toMatchObject({ email: EMAIL, type: "signup" });
  expect(unexpected).toEqual([]);
});

test("unconfirmed password login offers resend and verification without another signup", async ({ page, context }) => {
  const { calls, unexpected } = await mockServices(context);
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Email chưa được xác nhận");
  await page.getByRole("button", { name: "Gửi lại mã", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Đã yêu cầu gửi lại mã");
  await page.getByLabel("Mã xác nhận OTP").fill("000123");
  await page.getByRole("button", { name: "Xác nhận mã OTP" }).click();
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);
  expect(calls.filter((call) => call.path.endsWith("/signup"))).toHaveLength(0);
  expect(calls.find((call) => call.path.endsWith("/token"))?.body).toMatchObject({ email: EMAIL, password: PASSWORD });
  expect(unexpected).toEqual([]);
});

for (const scenario of [
  { code: "email_address_not_authorized", status: 400, message: "cấu hình gửi thư" },
  { code: "over_email_send_rate_limit", status: 429, message: "gửi email đã đạt giới hạn" },
]) {
  test(`signup ${scenario.code} shows an error without claiming a code was sent`, async ({ page, context }) => {
    const { unexpected } = await mockServices(context, { signup: authError(scenario.code, scenario.status) });
    await openSignup(page);
    await submitSignup(page);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(scenario.message);
    await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Xác nhận email" })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await pendingStorage(page)).toBeNull();
    expect(unexpected).toEqual([]);
  });
}

test("resend HTTP 429 keeps verification available and never shows a success notice", async ({ page, context }) => {
  const { calls, unexpected } = await mockServices(context, { resend: authError("over_request_rate_limit", 429) });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByRole("button", { name: "Tôi đã đăng ký và cần xác nhận email" }).click();
  await page.getByRole("button", { name: "Gửi lại mã", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("quá nhiều yêu cầu");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await expect(page.getByLabel("Mã xác nhận OTP")).toBeEnabled();
  await expect(page.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();
  expect(calls.filter((call) => call.path.endsWith("/resend"))).toHaveLength(1);
  expect(unexpected).toEqual([]);
});

test("existing-account signup returns to login instead of waiting for an OTP that is never sent", async ({ page, context }) => {
  const { unexpected } = await mockServices(context, {
    signup: { status: 200, body: { ...USER, identities: [] } },
  });
  await openSignup(page);
  await submitSignup(page);
  await expect(page.getByRole("status")).toContainText("không có mã OTP nào được gửi");
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(EMAIL);
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveValue("");
  expect(await pendingStorage(page)).toBeNull();
  expect(unexpected).toEqual([]);
});

test("SMTP failure during signup stays on the form and says no code was sent", async ({ page, context }) => {
  const { unexpected } = await mockServices(context, {
    signup: { status: 500, body: { code: 500, error_code: "unexpected_failure", msg: "Error sending confirmation email" } },
  });
  await openSignup(page);
  await submitSignup(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("chưa có mã OTP nào được gửi");
  await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();
  expect(await pendingStorage(page)).toBeNull();
  expect(unexpected).toEqual([]);
});

test("password toggle reveals and hides the value and resets when switching forms", async ({ page, context }, testInfo) => {
  const { unexpected } = await mockServices(context);
  await openSignup(page);
  const password = page.getByLabel("Mật khẩu", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(PASSWORD);
  await page.screenshot({ path: testInfo.outputPath("password-visible.png"), fullPage: true });
  await page.getByRole("button", { name: "Ẩn mật khẩu" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
  await page.locator(".auth-switch").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveAttribute("type", "password");
  await page.getByLabel("Mật khẩu", { exact: true }).press("Enter");
  expect(unexpected).toEqual([]);
});

test("editing the email clears pending verification and sends the next signup to the new address", async ({ page, context }) => {
  const { calls, unexpected } = await mockServices(context);
  await openSignup(page);
  await submitSignup(page);
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await page.getByLabel("Mã xác nhận OTP").fill("987654");
  await page.getByRole("button", { name: "Dùng email khác" }).click();
  await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveValue("");
  expect(await pendingStorage(page)).toBeNull();
  await page.getByLabel("Email", { exact: true }).fill("second@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await submitSignup(page);
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await expect(page.locator(".auth-email")).toHaveText("second@example.com");
  await expect(page.getByLabel("Mã xác nhận OTP")).toHaveValue("");
  expect(calls.filter((call) => call.path.endsWith("/signup")).map((call) => call.body.email)).toEqual([EMAIL, "second@example.com"]);
  expect(JSON.parse((await pendingStorage(page))!).email).toBe("second@example.com");
  expect(unexpected).toEqual([]);
});

test("selected PDF and JD can start analysis without a separate upload click", async ({ page, context }) => {
  const { apiCalls, unexpected } = await mockServices(context, { login: { status: 200, body: confirmedSession() } });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Phân tích" }).click();
  await expect(page.getByRole("heading", { name: /Tối Ưu Hóa Hồ Sơ/ })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "demo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic CV test file"),
  });
  await expect(page.getByText("Sẵn sàng tải lên", { exact: false })).toBeVisible();
  await page.locator(".jd-input").first().fill("We need a Backend Developer with TypeScript, REST APIs and PostgreSQL experience.");
  const analyzeButton = page.getByRole("button", { name: "Phân tích bằng AI" });
  await expect(analyzeButton).toBeEnabled();
  await analyzeButton.click();
  await expect(page.getByRole("heading", { name: "Phân tích mức độ phù hợp" })).toBeVisible();
  expect(apiCalls.filter((call) => call.path === "/api/cv/upload")).toHaveLength(1);
  expect(apiCalls.find((call) => call.path === "/api/analyze")?.body).toMatchObject({ cv_id: CV_ID });
  expect(unexpected).toEqual([]);
});

async function openForgotPassword(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("Demo@Example.COM");
  await page.getByRole("button", { name: "Quên mật khẩu?" }).click();
  await expect(page.getByRole("heading", { name: "Quên mật khẩu" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("Demo@Example.COM");
  await page.getByRole("button", { name: "Gửi mã đặt lại mật khẩu" }).click();
  await expect(page.getByRole("heading", { name: "Đặt lại mật khẩu" })).toBeVisible();
}

const NEW_PASSWORD = "NewDemoPassword!2027";

test("forgot password sends a code, verifies it as recovery, sets the new password and returns to login", async ({ page, context }, testInfo) => {
  const { calls, unexpected } = await mockServices(context, { login: { status: 200, body: confirmedSession() } });
  await openForgotPassword(page);
  await expect(page.getByRole("status")).toContainText("mã đặt lại mật khẩu đã được gửi");
  await expect(page.locator(".auth-email")).toHaveText(EMAIL);
  expect(calls.find((call) => call.path.endsWith("/recover"))?.body).toMatchObject({ email: EMAIL });
  await page.screenshot({ path: testInfo.outputPath("reset-password.png"), fullPage: true });

  await page.getByLabel("Mã xác nhận OTP").fill("999999");
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Nhập lại mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("không đúng hoặc đã hết hạn");
  await expect(page.getByRole("heading", { name: "Đặt lại mật khẩu" })).toBeVisible();

  await page.getByLabel("Mã xác nhận OTP").fill("000123");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Đã đổi mật khẩu");
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(EMAIL);
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveValue("");

  expect(calls.filter((call) => call.path.endsWith("/verify")).map((call) => call.body.type)).toEqual(["recovery", "recovery"]);
  const update = calls.find((call) => call.path.endsWith("/user") && call.body.password);
  expect(update?.body).toMatchObject({ password: NEW_PASSWORD });
  const allStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(allStorage).not.toContain(NEW_PASSWORD);
  expect(allStorage).not.toContain("000123");
  expect(unexpected).toEqual([]);
});

test("mismatched new passwords are caught before the reset code is spent", async ({ page, context }) => {
  const { calls, unexpected } = await mockServices(context);
  await openForgotPassword(page);
  await page.getByLabel("Mã xác nhận OTP").fill("000123");
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Nhập lại mật khẩu mới", { exact: true }).fill(`${NEW_PASSWORD}x`);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("chưa khớp");
  expect(calls.filter((call) => call.path.endsWith("/verify"))).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

test("a rejected new password can be retried without another code", async ({ page, context }) => {
  const { calls, unexpected } = await mockServices(context, {
    updateUser: [authError("same_password", 422), { status: 200, body: USER }],
  });
  await openForgotPassword(page);
  await page.getByLabel("Mã xác nhận OTP").fill("000123");
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Nhập lại mật khẩu mới", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("khác mật khẩu cũ");
  await expect(page.getByLabel("Mã xác nhận OTP")).toHaveCount(0);
  await expect(page.getByText("Mã đã được chấp nhận")).toBeVisible();

  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Nhập lại mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByRole("status")).toContainText("Đã đổi mật khẩu");
  expect(calls.filter((call) => call.path.endsWith("/verify"))).toHaveLength(1);
  expect(unexpected).toEqual([]);
});

test("reset code resend waits for the cooldown and surfaces email errors", async ({ page, context }) => {
  const { calls, unexpected } = await mockServices(context);
  await page.clock.install();
  await openForgotPassword(page);
  await expect(page.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await page.getByRole("button", { name: "Gửi lại mã", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Đã yêu cầu gửi lại mã");
  await expect(page.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();
  expect(calls.filter((call) => call.path.endsWith("/recover"))).toHaveLength(2);
  await page.getByRole("button", { name: "Quay lại đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("SMTP failure when requesting a reset code stays on the email step", async ({ page, context }) => {
  const { unexpected } = await mockServices(context, {
    recover: { status: 500, body: { code: 500, error_code: "unexpected_failure", msg: "Error sending recovery email" } },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Quên mật khẩu?" }).click();
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByRole("button", { name: "Gửi mã đặt lại mật khẩu" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("chưa có mã OTP nào được gửi");
  await expect(page.getByRole("heading", { name: "Quên mật khẩu" })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("signup shows a password strength meter that lights up while typing", async ({ page, context }, testInfo) => {
  const { unexpected } = await mockServices(context);
  await page.goto("/");
  await expect(page.locator(".auth-strength")).toHaveCount(0);
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();

  const password = page.getByLabel("Mật khẩu", { exact: true });
  const meter = page.locator(".auth-strength");
  await expect(password).toHaveAttribute("aria-describedby", "password-strength");
  await expect(meter).toHaveAttribute("data-score", "0");
  await expect(meter).toContainText("Chưa nhập");

  await password.fill("abc");
  await expect(meter).toHaveAttribute("data-score", "1");
  await expect(meter.locator(".auth-strength-label strong")).toHaveText("Yếu");
  await expect(meter.locator(".auth-strength-bar .is-lit")).toHaveCount(1);

  await password.fill(PASSWORD);
  await expect(meter).toHaveAttribute("data-score", "4");
  await expect(meter.locator(".auth-strength-label strong")).toHaveText("Mạnh");
  await expect(meter.locator(".auth-strength-bar .is-lit")).toHaveCount(4);
  await expect(meter.locator(".auth-strength-checks .is-met")).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath("signup-strength.png"), fullPage: true });

  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(meter).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("the sign-in screen opens dark and the lamp cord or a field turns the light on", async ({ page, context }, testInfo) => {
  const { unexpected } = await mockServices(context);
  // The cord sways all the time, so it never holds still for a click. Reduced motion stops the sway.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const shell = page.locator("main.auth-led");
  const cord = page.getByRole("button", { name: "Bật đèn" });
  await expect(shell).not.toHaveClass(/is-lit/);
  await expect(cord).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: testInfo.outputPath("auth-dark.png"), fullPage: true });

  await cord.click();
  await expect(shell).toHaveClass(/is-lit/);
  const offSwitch = page.getByRole("button", { name: "Tắt đèn" });
  await expect(offSwitch).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("auth-lit.png"), fullPage: true });

  await offSwitch.click();
  await expect(shell).not.toHaveClass(/is-lit/);
  await page.getByLabel("Email", { exact: true }).focus();
  await expect(shell).toHaveClass(/is-lit/);
  expect(unexpected).toEqual([]);
});
