"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../utils/supabase/client";
import {
  getAuthErrorMessage, isEmailNotConfirmed, isEmailOtp, normalizeEmail,
  OTP_RESEND_SECONDS, parsePendingVerification, VERIFICATION_STORAGE_KEY,
  type PendingEmailVerification
} from "../utils/auth-flow";

type Mode = "login" | "signup" | "verify";
type Notice = { text: string; error?: boolean } | null;

export function AuthScreen({ onSession, theme, header }: {
  onSession: (session: Session) => void;
  theme: "light" | "dark";
  header: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState<PendingEmailVerification | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const requestInFlight = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const otpInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNow(Date.now());
    try {
      const saved = parsePendingVerification(sessionStorage.getItem(VERIFICATION_STORAGE_KEY));
      if (saved) {
        setPending(saved);
        setEmail(saved.email);
        setMode("verify");
      } else sessionStorage.removeItem(VERIFICATION_STORAGE_KEY);
    } catch {
      // Verification also works when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const resendWait = pending ? Math.max(0, Math.ceil((pending.resendAvailableAt - now) / 1000)) : 0;

  function rememberVerification(next: PendingEmailVerification | null) {
    setPending(next);
    setNow(Date.now());
    try {
      if (next) sessionStorage.setItem(VERIFICATION_STORAGE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(VERIFICATION_STORAGE_KEY);
    } catch {
      // Do not store passwords or OTPs; lack of storage must not block the form.
    }
  }

  function openVerification(address: string, sent: boolean) {
    const requestedAt = Date.now();
    rememberVerification({ email: address, requestedAt,
      resendAvailableAt: sent ? requestedAt + OTP_RESEND_SECONDS * 1000 : requestedAt });
    setMode("verify");
    setEmail(address);
    setPassword("");
    setOtp("");
  }

  function finish(session: Session) {
    rememberVerification(null);
    setPassword("");
    setOtp("");
    onSession(session);
  }

  function changeMode(next: "login" | "signup") {
    if (requestInFlight.current) return;
    rememberVerification(null);
    setMode(next);
    setPassword("");
    setOtp("");
    setNotice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestInFlight.current) return;
    if (mode === "verify" && (!pending || !isEmailOtp(otp))) {
      setNotice({ text: "Nhập đầy đủ mã gồm 6–10 chữ số trong email.", error: true });
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    setNotice(null);
    const supabase = createClient();
    const address = normalizeEmail(email);
    try {
      if (mode === "verify" && pending) {
        const { data, error } = await supabase.auth.verifyOtp({
          email: pending.email, token: otp, type: "email"
        });
        if (error) throw error;
        if (!data.session) {
          setNotice({ text: "Email đã được xác nhận. Hãy quay lại đăng nhập bằng mật khẩu của bạn." });
          return;
        }
        finish(data.session);
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: address, password, options: { data: { full_name: fullName.trim() } }
        });
        if (error) throw error;
        if (data.session) finish(data.session);
        else {
          openVerification(address, true);
          setNotice({ text: "Yêu cầu đăng ký đã được tiếp nhận. Kiểm tra email và nhập mã xác nhận bên dưới. Nếu email đã có tài khoản, hãy quay lại đăng nhập." });
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) {
          if (isEmailNotConfirmed(error)) {
            openVerification(address, false);
            setNotice({ text: "Email chưa được xác nhận. Nhập mã đã nhận hoặc bấm Gửi lại mã." });
            return;
          }
          throw error;
        }
        if (data.session) finish(data.session);
      }
    } catch (error) {
      setNotice({ text: getAuthErrorMessage(error), error: true });
      if (mode === "verify") otpInput.current?.focus();
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  async function resend() {
    if (!pending || requestInFlight.current || Date.now() < pending.resendAvailableAt) return;
    requestInFlight.current = true;
    setBusy(true);
    setNotice(null);
    const sentAt = Date.now();
    // A local cooldown prevents repeated clicks; Supabase also enforces its own limits.
    rememberVerification({ ...pending, requestedAt: sentAt,
      resendAvailableAt: sentAt + OTP_RESEND_SECONDS * 1000 });
    try {
      const { error } = await createClient().auth.resend({ type: "signup", email: pending.email });
      if (error) throw error;
      setOtp("");
      setNotice({ text: "Đã yêu cầu gửi lại mã. Hãy dùng mã trong email mới nhất và kiểm tra cả thư mục Spam." });
      otpInput.current?.focus();
    } catch (error) {
      setNotice({ text: getAuthErrorMessage(error), error: true });
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  function continueVerification() {
    if (!emailInput.current?.reportValidity() || requestInFlight.current) return;
    openVerification(normalizeEmail(email), false);
    setNotice({ text: "Nhập mã xác nhận đã nhận. Nếu chưa có mã, bấm Gửi lại mã." });
  }

  return <main className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
    <div className="auth-topbar">{header}</div>
    <div className="auth-wrap">
      <section className="soft-card auth-card">
        <div className="auth-mark" aria-hidden="true">{mode === "verify" ? "✉" : "✦"}</div>
        <p className="eyebrow">AI CAREER READY</p>
        <h1>{mode === "verify" ? "Xác nhận email" : mode === "signup" ? "Tạo tài khoản" : "Chào mừng trở lại"}</h1>
        {mode === "verify" ? <p className="muted-copy">Nhập mã OTP từ email gửi tới <strong className="auth-email">{pending?.email}</strong></p>
          : <p className="muted-copy">Đối chiếu CV với công việc mơ ước và chuẩn bị phỏng vấn tự tin hơn.</p>}
        <form className="form-stack" onSubmit={submit} aria-busy={busy}>
          {mode === "verify" ? <>
            <label className="field-label" htmlFor="email-otp">Mã xác nhận OTP</label>
            <input ref={otpInput} id="email-otp" className="form-input otp-input" required autoFocus
              value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10}
              placeholder="Nhập mã trong email" disabled={busy} aria-describedby="otp-help" />
            <p id="otp-help" className="auth-hint">Dùng mã trong email mới nhất. Nếu mã sai hoặc hết hạn, bạn có thể yêu cầu mã mới.</p>
          </> : <>
            {mode === "signup" && <label className="field-label">Họ và tên<input required maxLength={120}
              value={fullName} onChange={(event) => setFullName(event.target.value)} className="form-input" autoComplete="name" disabled={busy} /></label>}
            <label className="field-label">Email<input ref={emailInput} required type="email" maxLength={320}
              value={email} onChange={(event) => setEmail(event.target.value)} className="form-input" autoComplete="email" disabled={busy} /></label>
            <label className="field-label">Mật khẩu<input required type="password" minLength={8} maxLength={128}
              value={password} onChange={(event) => setPassword(event.target.value)} className="form-input"
              autoComplete={mode === "signup" ? "new-password" : "current-password"} disabled={busy} /></label>
          </>}
          {notice && <p role={notice.error ? "alert" : "status"}
            className={`notice ${notice.error ? "auth-error" : "notice-info"}`}>{notice.text}</p>}
          <button disabled={busy || (mode === "verify" && !isEmailOtp(otp))} className="primary-button">
            {busy ? "Đang xử lý..." : mode === "verify" ? "Xác nhận và đăng nhập" : mode === "signup" ? "Đăng ký và nhận mã OTP" : "Đăng nhập"}
          </button>
        </form>
        {mode === "verify" ? <div className="auth-verification-actions">
          <button type="button" className="secondary-button" disabled={busy || resendWait > 0} onClick={() => void resend()}>
            {resendWait > 0 ? `Gửi lại mã sau ${resendWait}s` : "Gửi lại mã"}
          </button>
          <p className="auth-hint">Chưa thấy email? Kiểm tra Spam và địa chỉ email phía trên. Nếu email đã có tài khoản, hãy đăng nhập bằng mật khẩu.</p>
          <div className="auth-links"><button type="button" disabled={busy} onClick={() => changeMode("signup")}>Dùng email khác</button>
            <button type="button" disabled={busy} onClick={() => changeMode("login")}>Quay lại đăng nhập</button></div>
        </div> : <>
          <p className="auth-switch">{mode === "signup" ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
            <button type="button" disabled={busy} onClick={() => changeMode(mode === "signup" ? "login" : "signup")}>
              {mode === "signup" ? "Đăng nhập" : "Đăng ký"}</button></p>
          <p className="auth-switch"><button type="button" disabled={busy} onClick={continueVerification}>Tôi đã đăng ký và cần xác nhận email</button></p>
        </>}
      </section>
    </div>
  </main>;
}
