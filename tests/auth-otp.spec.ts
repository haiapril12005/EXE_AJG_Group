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

type MockResponse = { status: number; body: unknown };
type RecordedRequest = { path: string; body: Record<string, unknown> };
type AuthMocks = {
  signup?: MockResponse;
  login?: MockResponse;
  resend?: MockResponse;
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
        case "/auth/v1/verify":
          return reply(route, body?.token === "000123"
            ? { status: 200, body: confirmedSession() }
            : authError("otp_expired", 403));
        case "/auth/v1/user":
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
          } } });
        case "/api/analyze":
          return reply(route, { status: 200, body: {
            analysis_id: "00000000-0000-4000-8000-000000000003",
            rci_score: 75,
            layer_1_skills: { matched: ["TypeScript"], missing: [], evidence: [] },
            layer_2_projects: [],
            layer_3_education: { major_matched: false, english_matched: false, notes: "No evidence", evidence: [] },
            layer_4_mock: ["Question one?", "Question two?", "Question three?"],
            is_premium_unlocked: true,
            credits_remaining: null,
          } });
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

test("signup verifies an entered OTP, rejects expired code, then opens the authenticated app", async ({ page, context }, testInfo) => {
  const { calls, unexpected } = await mockServices(context);
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
  await page.getByRole("button", { name: "Xác nhận và đăng nhập" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("không đúng hoặc đã hết hạn");
  await expect(page.getByRole("heading", { name: "Xác nhận email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);

  await otp.fill("000123");
  await page.getByRole("button", { name: "Xác nhận và đăng nhập" }).click();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
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
  await page.getByRole("button", { name: "Xác nhận và đăng nhập" }).click();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
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

test("obfuscated existing-user signup gives generic guidance without claiming delivery", async ({ page, context }) => {
  const { unexpected } = await mockServices(context, {
    signup: { status: 200, body: { ...USER, identities: [] } },
  });
  await openSignup(page);
  await submitSignup(page);
  await expect(page.getByRole("status")).toContainText("Yêu cầu đăng ký đã được tiếp nhận");
  await expect(page.getByRole("status")).toContainText("Nếu email đã có tài khoản");
  await expect(page.getByRole("status")).not.toContainText("Đã gửi");
  await page.getByRole("button", { name: "Quay lại đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveValue("");
  expect(await pendingStorage(page)).toBeNull();
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
