import assert from "node:assert/strict";
import test from "node:test";
import {
  getAuthErrorMessage,
  isEmailNotConfirmed,
  isEmailOtp,
  normalizeEmail,
  OTP_RESEND_SECONDS,
  parsePendingVerification,
  VERIFICATION_STORAGE_KEY,
} from "../utils/auth-flow";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function stored(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    email: "demo@example.com",
    requestedAt: NOW - 10_000,
    resendAvailableAt: NOW + 50_000,
    ...overrides,
  });
}

test("email normalization handles paste whitespace and casing", () => {
  assert.equal(normalizeEmail("  Demo.User+Test@EXAMPLE.COM\n"), "demo.user+test@example.com");
});

test("OTP validation preserves leading zeroes and supports configured lengths", () => {
  const token = "000123";
  assert.equal(isEmailOtp(token), true);
  assert.equal(token, "000123");
  assert.equal(isEmailOtp("00123456"), true);
  assert.equal(isEmailOtp("0000123456"), true);
  for (const invalid of ["12345", "12345678901", "123 456", "123456\n", "１２３４５６", "12e345", 123456, null]) {
    assert.equal(isEmailOtp(invalid), false, `must reject ${JSON.stringify(invalid)}`);
  }
});

test("pending verification restores normalized metadata without credentials", () => {
  const restored = parsePendingVerification(stored({
    email: " DEMO@Example.COM ",
    password: "must-not-be-restored",
    token: "001234",
    access_token: "must-not-be-restored",
  }), NOW);
  assert.deepEqual(restored, {
    email: "demo@example.com",
    requestedAt: NOW - 10_000,
    resendAvailableAt: NOW + 50_000,
  });
  assert.equal(JSON.stringify(restored).includes("must-not-be-restored"), false);
  assert.equal(VERIFICATION_STORAGE_KEY, "cvfit.pending-email-verification");
});

test("pending verification rejects malformed or wrong-shaped storage", () => {
  for (const raw of [null, "", "{broken", "null", "[]", '"email@example.com"', "42", "{}"]) {
    assert.equal(parsePendingVerification(raw, NOW), null);
  }
  for (const email of ["", "missing-at", "a@@example.com", "a b@example.com", "a@example", 123, "a".repeat(309) + "@example.com"]) {
    assert.equal(parsePendingVerification(stored({ email }), NOW), null);
  }
  for (const field of ["requestedAt", "resendAvailableAt"]) {
    for (const value of [null, "1800000000000", -1, NOW + 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(parsePendingVerification(stored({ [field]: value }), NOW), null);
    }
  }
});

test("pending verification expires after 24 hours and rejects future requests", () => {
  assert.notEqual(parsePendingVerification(stored({ requestedAt: NOW - DAY + 1 }), NOW), null);
  assert.equal(parsePendingVerification(stored({ requestedAt: NOW - DAY }), NOW), null);
  assert.equal(parsePendingVerification(stored({ requestedAt: NOW - DAY - 1 }), NOW), null);
  assert.equal(parsePendingVerification(stored({ requestedAt: NOW + 1 }), NOW), null);
  assert.equal(parsePendingVerification(stored({ resendAvailableAt: NOW - 10_001 }), NOW), null);
  assert.equal(parsePendingVerification(stored(), Number.NaN), null);
});

test("tampered cooldown cannot lock out resend for more than 60 seconds", () => {
  assert.equal(OTP_RESEND_SECONDS, 60);
  assert.equal(
    parsePendingVerification(stored({ resendAvailableAt: NOW + DAY }), NOW)?.resendAvailableAt,
    NOW + 60_000,
  );
  // A completed cooldown stays completed after reload.
  assert.equal(
    parsePendingVerification(stored({ resendAvailableAt: NOW - 1 }), NOW)?.resendAvailableAt,
    NOW - 1,
  );
});

test("unconfirmed email detection relies on the server code", () => {
  assert.equal(isEmailNotConfirmed({ code: "email_not_confirmed" }), true);
  assert.equal(isEmailNotConfirmed({ code: "invalid_credentials", message: "Email not confirmed" }), false);
  assert.equal(isEmailNotConfirmed(new Error("Email not confirmed")), false);
  assert.equal(isEmailNotConfirmed(null), false);
});

test("expired code, email quota and request rate errors produce distinct guidance", () => {
  assert.match(getAuthErrorMessage({ code: "otp_expired" }), /hết hạn/);
  assert.match(getAuthErrorMessage({ code: "over_email_send_rate_limit" }), /gửi email đã đạt giới hạn/);
  assert.match(getAuthErrorMessage({ code: "over_request_rate_limit" }), /quá nhiều yêu cầu/);
  assert.equal(
    getAuthErrorMessage({ status: 429, message: "internal diagnostic" }),
    getAuthErrorMessage({ code: "over_request_rate_limit" }),
  );
  assert.match(getAuthErrorMessage({ code: "email_address_not_authorized" }), /cấu hình gửi thư/);
});

test("known auth errors remain actionable without rendering upstream messages", () => {
  const cases: Array<[string, RegExp]> = [
    ["email_not_confirmed", /chưa được xác nhận/],
    ["invalid_credentials", /mật khẩu chưa đúng/],
    ["user_already_exists", /đã tồn tại/],
    ["signup_disabled", /tạm đóng/],
    ["email_provider_disabled", /chưa khả dụng/],
    ["weak_password", /chưa đủ mạnh/],
    ["email_address_invalid", /email không hợp lệ/],
    ["unexpected_failure", /chưa xử lý được/],
  ];
  for (const [code, expected] of cases) {
    assert.match(getAuthErrorMessage({ code, message: "private-provider-diagnostic" }), expected);
  }
});

test("network errors and unknown provider errors have safe fallbacks", () => {
  assert.match(getAuthErrorMessage(new TypeError("Failed to fetch")), /kết nối mạng/);
  assert.match(getAuthErrorMessage({ name: "AuthRetryableFetchError" }), /kết nối mạng/);
  assert.match(getAuthErrorMessage({ message: "NetworkError when attempting to fetch resource." }), /kết nối mạng/);
  const fallback = getAuthErrorMessage(null);
  for (const error of [undefined, "secret", { code: "unknown", message: "secret" }, { code: "__proto__" }, { code: "constructor" }]) {
    assert.equal(getAuthErrorMessage(error), fallback);
  }
  assert.equal(fallback.includes("secret"), false);
});
