export interface PendingEmailVerification {
  email: string;
  requestedAt: number;
  resendAvailableAt: number;
}

export const OTP_RESEND_SECONDS = 60;
export const VERIFICATION_STORAGE_KEY = "cvfit.pending-email-verification";

const PENDING_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailOtp(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{6,10}$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isEmailNotConfirmed(error: unknown): boolean {
  return asRecord(error)?.code === "email_not_confirmed";
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  otp_expired: "Mã xác nhận không đúng hoặc đã hết hạn. Hãy kiểm tra mã trong email mới nhất hoặc gửi lại mã.",
  over_email_send_rate_limit: "Dịch vụ gửi email đã đạt giới hạn. Vui lòng chờ một lúc rồi gửi lại mã.",
  over_request_rate_limit: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại.",
  email_address_not_authorized: "Dịch vụ gửi email chưa hỗ trợ địa chỉ này. Vui lòng liên hệ nhóm hỗ trợ để kiểm tra cấu hình gửi thư.",
  email_not_confirmed: "Email chưa được xác nhận. Hãy nhập mã trong email hoặc yêu cầu gửi lại mã.",
  invalid_credentials: "Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.",
  user_already_exists: "Tài khoản đã tồn tại. Hãy đăng nhập bằng email và mật khẩu của bạn.",
  signup_disabled: "Đăng ký tài khoản hiện đang tạm đóng. Vui lòng thử lại sau.",
  email_provider_disabled: "Đăng nhập bằng email hiện chưa khả dụng. Vui lòng liên hệ nhóm hỗ trợ.",
  weak_password: "Mật khẩu chưa đủ mạnh. Hãy dùng ít nhất 8 ký tự và kết hợp chữ, số, ký tự đặc biệt.",
  email_address_invalid: "Địa chỉ email không hợp lệ. Vui lòng kiểm tra lại.",
  unexpected_failure: "Hệ thống chưa xử lý được yêu cầu. Vui lòng thử lại sau.",
};

export function getAuthErrorMessage(error: unknown): string {
  const details = asRecord(error);
  const code = typeof details?.code === "string" ? details.code : "";
  if (Object.prototype.hasOwnProperty.call(AUTH_ERROR_MESSAGES, code)) {
    return AUTH_ERROR_MESSAGES[code];
  }

  if (details?.status === 429) {
    return AUTH_ERROR_MESSAGES.over_request_rate_limit;
  }

  const message = typeof details?.message === "string" ? details.message : "";
  if (
    details?.name === "AuthRetryableFetchError" ||
    details?.code === "NETWORK_ERROR" ||
    /failed to fetch|fetch failed|network\s?(?:error|request failed)|load failed/i.test(message)
  ) {
    return "Không thể kết nối đến dịch vụ đăng nhập. Hãy kiểm tra kết nối mạng rồi thử lại.";
  }

  return "Không thể hoàn tất yêu cầu. Vui lòng thử lại sau.";
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Restore only the email and timing metadata; credentials are never retained. */
export function parsePendingVerification(
  raw: string | null,
  now = Date.now(),
): PendingEmailVerification | null {
  if (!raw || !isTimestamp(now)) return null;

  try {
    const value = asRecord(JSON.parse(raw));
    if (!value || typeof value.email !== "string") return null;
    const email = normalizeEmail(value.email);
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

    const { requestedAt, resendAvailableAt } = value;
    if (!isTimestamp(requestedAt) || !isTimestamp(resendAvailableAt)) return null;
    if (requestedAt > now || now - requestedAt >= PENDING_VERIFICATION_TTL_MS) return null;
    if (resendAvailableAt < requestedAt) return null;

    return {
      email,
      requestedAt,
      resendAvailableAt: Math.min(resendAvailableAt, now + OTP_RESEND_SECONDS * 1000),
    };
  } catch {
    return null;
  }
}
