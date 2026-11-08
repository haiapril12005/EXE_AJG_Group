"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../utils/api";
import { getAuthErrorMessage, isEmailOtp, normalizeEmail, OTP_RESEND_SECONDS } from "../../utils/auth-flow";
import { createClient, createVerificationClient } from "../../utils/supabase/client";
import { useApp } from "../app-frame";

type Notice = { text: string; error: boolean } | null;

/**
 * Changing the login email goes through Supabase Auth in the browser. With Supabase's default
 * "secure email change", both addresses get a code and the email changes once both are confirmed;
 * with it off, only the new address has a code, so either field may be left empty.
 */
export function EmailChangeCard() {
  const { session, token, refreshProfile } = useApp();
  const [user, setUser] = useState<User>(session.user);
  const [choosing, setChoosing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codeCurrent, setCodeCurrent] = useState("");
  const [codeNew, setCodeNew] = useState("");
  const [confirmed, setConfirmed] = useState({ current: false, next: false });
  const [resendLocked, setResendLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const resendTimer = useRef<number | undefined>(undefined);
  const currentEmail = user.email ?? "";
  const pending = user.new_email ?? null;

  useEffect(() => {
    setUser(session.user);
  }, [session.user]);

  // The stored session can be behind: a change may have finished from a link in another tab.
  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => {
      if (data.user) setUser(data.user);
    });
    return () => window.clearTimeout(resendTimer.current);
  }, []);

  function lockResend() {
    setResendLocked(true);
    window.clearTimeout(resendTimer.current);
    resendTimer.current = window.setTimeout(() => setResendLocked(false), OTP_RESEND_SECONDS * 1000);
  }

  function resetCodes() {
    setCodeCurrent("");
    setCodeNew("");
    setConfirmed({ current: false, next: false });
  }

  async function requestChange(event: FormEvent) {
    event.preventDefault();
    const address = normalizeEmail(newEmail);
    if (address === normalizeEmail(currentEmail)) {
      setNotice({ text: "Email mới phải khác email hiện tại.", error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      // The password is checked on a separate client, so the signed-in session is left alone.
      const verifier = createVerificationClient();
      const { error: wrongPassword } = await verifier.auth.signInWithPassword({ email: currentEmail, password });
      if (wrongPassword) throw wrongPassword;
      await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
      const { data, error } = await createClient().auth.updateUser({ email: address },
        { emailRedirectTo: `${window.location.origin}/profile` });
      if (error) throw error;
      setPassword("");
      setNewEmail("");
      setChoosing(false);
      resetCodes();
      lockResend();
      setUser(data.user);
      setNotice({ text: `Đã gửi mã. Kiểm tra hộp thư của ${address} và ${currentEmail} (cả thư mục Spam).`, error: false });
    } catch (error) {
      setNotice({ text: getAuthErrorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCodes(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    const steps = [
      { key: "current" as const, email: currentEmail, code: codeCurrent },
      { key: "next" as const, email: pending, code: codeNew }
    ].filter((step) => !confirmed[step.key] && step.code);
    if (!steps.length || steps.some((step) => !isEmailOtp(step.code))) {
      setNotice({ text: "Nhập đầy đủ mã gồm 6–10 chữ số trong email.", error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const supabase = createClient();
      let progress = confirmed;
      let finished = false;
      for (const step of steps) {
        const { data, error } = await supabase.auth.verifyOtp({ email: step.email, token: step.code, type: "email_change" });
        if (error) throw error;
        progress = { ...progress, [step.key]: true };
        setConfirmed(progress);
        // Only the last confirmation returns a session; the first one just moves the change along.
        if (data.session) finished = true;
      }
      if (!finished) {
        setNotice({ text: "Đã xác nhận mã này. Hãy nhập nốt mã ở địa chỉ còn lại để hoàn tất.", error: false });
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (data.user) setUser(data.user);
      resetCodes();
      // The account table keeps its own copy of the email for the admin tools.
      await api("/user/email/sync", token, { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
      await refreshProfile().catch(() => undefined);
      setNotice({ text: `Đã đổi email. Từ nay hãy đăng nhập bằng ${data.user?.email ?? pending}.`, error: false });
    } catch (error) {
      setNotice({ text: getAuthErrorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!pending) return;
    setBusy(true);
    setNotice(null);
    lockResend();
    try {
      const { error } = await createClient().auth.resend({ type: "email_change", email: pending });
      if (error) throw error;
      resetCodes();
      setNotice({ text: "Đã yêu cầu gửi lại mã. Hãy dùng mã trong email mới nhất.", error: false });
    } catch (error) {
      setNotice({ text: getAuthErrorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  const noticeLine = notice && <p role={notice.error ? "alert" : "status"} className={`notice ${notice.error ? "auth-error" : "notice-info"}`}>{notice.text}</p>;
  const heading = (title: string, text: string) => <div className="section-heading">
    <span className="step-badge">3</span>
    <div><h2>{title}</h2><p>{text}</p></div>
  </div>;

  if (pending && !choosing) {
    const codeField = (label: string, value: string, onChange: (next: string) => void, done: boolean) => <label className="field-label">{label}
      {done ? <span className="profile-confirmed">✓ Đã xác nhận</span>
        : <input className="form-input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="Nhập mã trong email"
          value={value} disabled={busy} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 10))} />}
    </label>;
    return <section className="soft-card input-card profile-email-card">
      {heading("Xác nhận đổi email", "Email chưa đổi cho tới khi bạn xác nhận xong.")}
      <form className="form-stack profile-form" onSubmit={confirmCodes} aria-busy={busy}>
        <p className="profile-email-pending">Đang chờ xác nhận email mới: {pending}</p>
        {codeField(`Mã gửi tới email mới (${pending})`, codeNew, setCodeNew, confirmed.next)}
        {codeField(`Mã gửi tới email hiện tại (${currentEmail})`, codeCurrent, setCodeCurrent, confirmed.current)}
        <p className="muted-copy">Nếu thư chỉ có nút xác nhận, không có mã, hãy bấm nút trong từng thư rồi tải lại trang này.</p>
        {noticeLine}
        <button className="primary-button" disabled={busy || !(codeNew || codeCurrent)}>{busy ? "Đang xử lý..." : "Xác nhận đổi email"}</button>
        <div className="profile-email-actions">
          <button type="button" className="text-button" disabled={busy || resendLocked} onClick={() => void resend()}>{resendLocked ? `Có thể gửi lại sau ${OTP_RESEND_SECONDS} giây` : "Gửi lại mã"}</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => { setChoosing(true); setNotice(null); }}>Dùng email khác</button>
        </div>
      </form>
    </section>;
  }

  return <section className="soft-card input-card profile-email-card">
    {heading("Đổi email", "Mã xác nhận được gửi tới cả email hiện tại và email mới.")}
    <form className="form-stack profile-form" onSubmit={requestChange} aria-busy={busy}>
      <p className="muted-copy">Email hiện tại: <strong>{currentEmail}</strong></p>
      <label className="field-label">Email mới<input className="form-input" type="email" required maxLength={320} autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></label>
      <label className="field-label">Mật khẩu để xác nhận<input className="form-input" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {noticeLine}
      <button className="secondary-button" disabled={busy}>{busy ? "Đang xử lý..." : "Gửi mã xác nhận"}</button>
      {choosing && <button type="button" className="text-button" disabled={busy} onClick={() => { setChoosing(false); setNotice(null); }}>Quay lại nhập mã</button>}
    </form>
  </section>;
}
