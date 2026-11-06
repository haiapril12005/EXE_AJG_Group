"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient, createVerificationClient } from "../utils/supabase/client";
import "./auth-led.css";
import {
  getAuthErrorMessage, isEmailNotConfirmed, isEmailOtp, isExistingAccountSignup, newPasswordProblem, normalizeEmail,
  OTP_RESEND_SECONDS, parsePendingVerification, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordStrength, VERIFICATION_STORAGE_KEY,
  type PendingEmailVerification
} from "../utils/auth-flow";

// "forgot" asks for the email; "reset" takes the emailed code and the new password.
type Mode = "login" | "signup" | "verify" | "forgot" | "reset";
type Notice = { text: string; error?: boolean } | null;

function PasswordField({ value, onChange, autoComplete, disabled, id = "auth-password", label = "Mật khẩu", describedBy }: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
  id?: string;
  label?: string;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? "Ẩn mật khẩu" : "Hiện mật khẩu";
  return <div className="field-label">
    <label htmlFor={id}>{label}</label>
    <div className="password-field">
      <input id={id} required type={visible ? "text" : "password"} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH}
        value={value} onChange={(event) => onChange(event.target.value)} className="form-input"
        autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={disabled}
        aria-describedby={describedBy} />
      <button type="button" className="password-toggle" aria-label={toggleLabel} title={toggleLabel}
        disabled={disabled} onClick={() => setVisible((current) => !current)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  </div>;
}

/** Four lit segments plus the criteria, so the level never depends on color alone. */
function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = passwordStrength(password);
  return <div className="auth-strength" data-score={strength.score} id="password-strength">
    <div className="auth-strength-bar" aria-hidden="true">
      {[1, 2, 3, 4].map((segment) => <span key={segment} className={strength.score >= segment ? "is-lit" : ""} />)}
    </div>
    <p className="auth-strength-label" aria-live="polite">
      <span>Độ mạnh mật khẩu</span><strong>{strength.label}</strong>
    </p>
    <ul className="auth-strength-checks">
      {strength.checks.map((check) => <li key={check.label} className={check.met ? "is-met" : ""}>
        {check.label}<span className="sr-only">{check.met ? " (đã đạt)" : " (chưa đạt)"}</span>
      </li>)}
    </ul>
  </div>;
}

const LED_COUNT = 18;

const TITLES: Record<Mode, string> = {
  login: "Chào mừng trở lại",
  signup: "Tạo tài khoản",
  verify: "Xác nhận email",
  forgot: "Quên mật khẩu",
  reset: "Đặt lại mật khẩu"
};

const SUBMIT_LABELS: Record<Mode, string> = {
  login: "Đăng nhập",
  signup: "Đăng ký và nhận mã OTP",
  verify: "Xác nhận mã OTP",
  forgot: "Gửi mã đặt lại mật khẩu",
  reset: "Đổi mật khẩu"
};

export function AuthScreen({ onSession, header }: {
  onSession: (session: Session) => void;
  header: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState<PendingEmailVerification | null>(null);
  // Kept in memory only: a reload returns to login instead of a half-finished reset.
  const [recovery, setRecovery] = useState<PendingEmailVerification | null>(null);
  // Holds the recovery session once the code is accepted, so a rejected new password can be
  // retried without spending another code. It lives in memory and never signs in to the app.
  const recoveryClient = useRef<ReturnType<typeof createVerificationClient> | null>(null);
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  // The screen opens in the dark; the lamp's pull cord, or reaching for a field, turns it on.
  const [lightOn, setLightOn] = useState(false);
  const [cordPulled, setCordPulled] = useState(false);
  const cordTimer = useRef<number | undefined>(undefined);
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

  const waiting = mode === "reset" ? recovery : pending;

  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const resendWait = waiting ? Math.max(0, Math.ceil((waiting.resendAvailableAt - now) / 1000)) : 0;

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

  function changeMode(next: "login" | "signup" | "forgot") {
    if (requestInFlight.current) return;
    rememberVerification(null);
    setRecovery(null);
    recoveryClient.current = null;
    setCodeAccepted(false);
    setMode(next);
    setPassword("");
    setPasswordAgain("");
    setOtp("");
    setNotice(null);
  }

  /** Supabase answers the same way whether or not the email has an account. */
  async function requestPasswordReset(address: string) {
    const { error } = await createVerificationClient().auth.resetPasswordForEmail(address);
    if (error) throw error;
    const requestedAt = Date.now();
    setRecovery({ email: address, requestedAt, resendAvailableAt: requestedAt + OTP_RESEND_SECONDS * 1000 });
    setNow(requestedAt);
    recoveryClient.current = null;
    setCodeAccepted(false);
    setOtp("");
  }

  async function resetPassword(address: string) {
    let verifier = recoveryClient.current;
    if (!verifier) {
      verifier = createVerificationClient();
      const { error } = await verifier.auth.verifyOtp({ email: address, token: otp, type: "recovery" });
      if (error) throw error;
      recoveryClient.current = verifier;
      setCodeAccepted(true);
    }
    const { error } = await verifier.auth.updateUser({ password });
    if (error) throw error;
    await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
    recoveryClient.current = null;
    setCodeAccepted(false);
    setRecovery(null);
    setMode("login");
    setEmail(address);
    setPassword("");
    setPasswordAgain("");
    setOtp("");
    setNotice({ text: "Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới." });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestInFlight.current) return;
    const needsCode = mode === "verify" || (mode === "reset" && !recoveryClient.current);
    if ((mode === "verify" && !pending) || (mode === "reset" && !recovery) || (needsCode && !isEmailOtp(otp))) {
      setNotice({ text: "Nhập đầy đủ mã gồm 6–10 chữ số trong email.", error: true });
      return;
    }
    const passwordProblem = mode === "reset" ? newPasswordProblem(password, passwordAgain) : null;
    if (passwordProblem) {
      setNotice({ text: passwordProblem, error: true });
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    setNotice(null);
    const supabase = createClient();
    const address = normalizeEmail(email);
    try {
      if (mode === "forgot") {
        await requestPasswordReset(address);
        setEmail(address);
        setMode("reset");
        setNotice({ text: "Nếu email này đã có tài khoản, mã đặt lại mật khẩu đã được gửi. Kiểm tra email (cả thư mục Spam) và nhập mã bên dưới." });
      } else if (mode === "reset" && recovery) {
        await resetPassword(recovery.email);
      } else if (mode === "verify" && pending) {
        const verifier = createVerificationClient();
        const { error } = await verifier.auth.verifyOtp({
          email: pending.email, token: otp, type: "email"
        });
        if (error) throw error;
        // The email is confirmed; a failed cleanup of the unused session must not undo that.
        await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
        rememberVerification(null);
        setMode("login");
        setEmail(pending.email);
        setPassword("");
        setOtp("");
        setNotice({ text: "Email đã được xác nhận. Hãy đăng nhập bằng mật khẩu của bạn." });
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: address, password, options: { data: { full_name: fullName.trim() } }
        });
        if (error) throw error;
        if (data.session) finish(data.session);
        else if (isExistingAccountSignup(data.user)) {
          setMode("login");
          setPassword("");
          setNotice({ text: "Email này đã có tài khoản nên không có mã OTP nào được gửi. Hãy đăng nhập bằng mật khẩu của bạn." });
        } else {
          openVerification(address, true);
          setNotice({ text: "Yêu cầu đăng ký đã được tiếp nhận. Kiểm tra email và nhập mã xác nhận bên dưới." });
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
      if ((mode === "verify" || mode === "reset") && !recoveryClient.current) otpInput.current?.focus();
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  async function resendRecovery() {
    if (!recovery || requestInFlight.current || Date.now() < recovery.resendAvailableAt) return;
    requestInFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await requestPasswordReset(recovery.email);
      setNotice({ text: "Đã yêu cầu gửi lại mã. Hãy dùng mã trong email mới nhất và kiểm tra cả thư mục Spam." });
      otpInput.current?.focus();
    } catch (error) {
      // A failed request still waits out the cooldown, like the signup resend.
      const failedAt = Date.now();
      setRecovery({ ...recovery, requestedAt: failedAt, resendAvailableAt: failedAt + OTP_RESEND_SECONDS * 1000 });
      setNotice({ text: getAuthErrorMessage(error), error: true });
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
      setNotice({ text: "Đã yêu cầu gửi lại mã. Hãy dùng mã trong email mới nhất và kiểm tra cả thư mục Spam. Thư mới chỉ được gửi khi email đã đăng ký và chưa xác nhận. Nếu vẫn không thấy thư, hãy đăng nhập hoặc đăng ký lại." });
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

  useEffect(() => () => window.clearTimeout(cordTimer.current), []);

  function pullCord() {
    setLightOn((current) => !current);
    setCordPulled(true);
    window.clearTimeout(cordTimer.current);
    cordTimer.current = window.setTimeout(() => setCordPulled(false), 450);
  }

  // The lit-lamp look needs a dark room, so this screen is dark whatever theme the app uses.
  return <main className={`app-shell theme-dark auth-led${lightOn ? " is-lit" : ""}`}>
    <div className="auth-topbar">{header}</div>
    <div className="auth-wrap">
      <div className="auth-stage">
        <div className="auth-glow" aria-hidden="true" />
        <div className="auth-lamp-group">
          <div className="auth-lamp" aria-hidden="true">
            <span className="auth-lamp-cord" /><span className="auth-lamp-cap" /><span className="auth-lamp-bulb" />
          </div>
          <div className={`auth-pull${cordPulled ? " is-pulled" : ""}`}>
            <span className="auth-pull-line" aria-hidden="true" />
            <button type="button" className="auth-pull-knob" onClick={pullCord}
              aria-pressed={lightOn} aria-label={lightOn ? "Tắt đèn" : "Bật đèn"}>
              <span aria-hidden="true" />
            </button>
          </div>
        </div>
        <section className="soft-card auth-card">
          <div className="auth-led-strip" aria-hidden="true">
            {Array.from({ length: LED_COUNT }, (_, index) => <span key={index} style={{ animationDelay: `${(index * 0.09).toFixed(2)}s` }} />)}
          </div>
          <p className="eyebrow">JOB READY</p>
          <h1>{TITLES[mode]}</h1>
          {mode === "verify" ? <p className="muted-copy">Nhập mã OTP từ email gửi tới <strong className="auth-email">{pending?.email}</strong></p>
            : mode === "reset" ? <p className="muted-copy">Nhập mã trong email gửi tới <strong className="auth-email">{recovery?.email}</strong> và đặt mật khẩu mới.</p>
            : mode === "forgot" ? <p className="muted-copy">Nhập email tài khoản. Chúng tôi sẽ gửi mã để bạn đặt mật khẩu mới.</p>
            : <p className="muted-copy">Đối chiếu CV với công việc mơ ước và chuẩn bị phỏng vấn tự tin hơn.</p>}
          <form className="form-stack" onSubmit={submit} aria-busy={busy} onFocus={() => setLightOn(true)}>
            {mode === "reset" ? <>
              {codeAccepted ? <p className="auth-hint">Mã đã được chấp nhận. Chỉ cần nhập lại mật khẩu mới.</p> : <>
                <label className="field-label" htmlFor="email-otp">Mã xác nhận OTP</label>
                <input ref={otpInput} id="email-otp" className="form-input otp-input" required autoFocus
                  value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 10))}
                  inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10}
                  placeholder="Nhập mã trong email" disabled={busy} />
              </>}
              <PasswordField id="new-password" label="Mật khẩu mới" value={password} onChange={setPassword}
                disabled={busy} autoComplete="new-password" />
              <PasswordField id="new-password-again" label="Nhập lại mật khẩu mới" value={passwordAgain}
                onChange={setPasswordAgain} disabled={busy} autoComplete="new-password" />
            </> : mode === "forgot" ? <>
              <label className="field-label">Email<input ref={emailInput} required type="email" maxLength={320} autoFocus
                value={email} onChange={(event) => setEmail(event.target.value)} className="form-input" autoComplete="email" disabled={busy} /></label>
            </> : mode === "verify" ? <>
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
              <PasswordField key={mode} value={password} onChange={setPassword} disabled={busy}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                describedBy={mode === "signup" ? "password-strength" : undefined} />
              {mode === "signup" && <PasswordStrengthMeter password={password} />}
              {mode === "login" && <div className="auth-links auth-forgot">
                <button type="button" disabled={busy} onClick={() => changeMode("forgot")}>Quên mật khẩu?</button>
              </div>}
            </>}
            {notice && <p role={notice.error ? "alert" : "status"}
              className={`notice ${notice.error ? "auth-error" : "notice-info"}`}>{notice.text}</p>}
            <button disabled={busy || ((mode === "verify" || (mode === "reset" && !codeAccepted)) && !isEmailOtp(otp))}
              className="primary-button">
              {busy ? "Đang xử lý..." : SUBMIT_LABELS[mode]}
            </button>
          </form>
          {mode === "reset" ? <div className="auth-verification-actions">
            <button type="button" className="secondary-button" disabled={busy || resendWait > 0} onClick={() => void resendRecovery()}>
              {resendWait > 0 ? `Gửi lại mã sau ${resendWait}s` : "Gửi lại mã"}
            </button>
            <p className="auth-hint">Chưa thấy email? Kiểm tra Spam và địa chỉ email phía trên. Mã chỉ được gửi khi email đã có tài khoản.</p>
            <div className="auth-links"><button type="button" disabled={busy} onClick={() => changeMode("forgot")}>Dùng email khác</button>
              <button type="button" disabled={busy} onClick={() => changeMode("login")}>Quay lại đăng nhập</button></div>
          </div> : mode === "forgot" ? <p className="auth-switch">
            <button type="button" disabled={busy} onClick={() => changeMode("login")}>Quay lại đăng nhập</button></p>
          : mode === "verify" ? <div className="auth-verification-actions">
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
    </div>
  </main>;
}
