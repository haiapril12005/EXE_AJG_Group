"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../utils/api";
import {
  newPasswordProblem,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordStrength
} from "../../utils/auth-flow";
import { formatUserCode, useApp, type Profile } from "../app-frame";
import { EmailChangeCard } from "./email-change";
import { AvatarEditor } from "./avatar-editor";

export default function ProfilePage() {
  const { session, token, profile, refreshProfile, signOut } = useApp();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoNotice, setInfoNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const userId = profile?.id || session.user.id;
  const userCode = profile?.user_code || formatUserCode(userId);
  const displayName = profile?.full_name || session.user.user_metadata?.full_name || session.user.email || "Người dùng";

  useEffect(() => {
    setFullName(profile?.full_name ?? (session.user.user_metadata?.full_name as string | undefined) ?? "");
    setPhone(profile?.phone ?? (session.user.user_metadata?.phone as string | undefined) ?? "");
  }, [profile, session.user]);

  async function copyUserId() {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Clipboard API may be blocked in some contexts
    }
  }

  async function handleSaveInfo(event: FormEvent) {
    event.preventDefault();
    if (savingInfo) return;
    setSavingInfo(true);
    setInfoNotice(null);
    try {
      const result = await api<{ user: Profile; message: string }>("/user/me", token, {
        method: "PUT",
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim()
        })
      });
      await refreshProfile();
      setInfoNotice({ text: result.message || "Đã cập nhật thông tin tài khoản." });
    } catch (error) {
      setInfoNotice({
        text: error instanceof Error ? error.message : "Không thể cập nhật thông tin hồ sơ.",
        error: true
      });
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    if (savingPassword) return;
    const problem = newPasswordProblem(newPassword, confirmPassword);
    if (problem) {
      setPasswordNotice({ text: problem, error: true });
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordNotice({ text: "Mật khẩu mới phải khác mật khẩu hiện tại.", error: true });
      return;
    }
    setSavingPassword(true);
    setPasswordNotice(null);
    try {
      const result = await api<{ updated: boolean; message: string }>("/user/password", token, {
        method: "PUT",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice({ text: result.message || "Đã đổi mật khẩu thành công." });
    } catch (error) {
      setPasswordNotice({
        text: error instanceof Error ? error.message : "Không thể đổi mật khẩu.",
        error: true
      });
    } finally {
      setSavingPassword(false);
    }
  }

  const strength = passwordStrength(newPassword);

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">TÀI KHOẢN CỦA BẠN</p>
        <h1>Hồ sơ cá nhân & Bảo mật</h1>
        <p>Quản lý thông tin liên hệ, cập nhật số điện thoại, địa chỉ email và mật khẩu đăng nhập.</p>
      </section>

      <section className="soft-card profile-hero-card">
        <div className="profile-hero-main">
          <AvatarEditor letter={String(displayName).trim().charAt(0).toUpperCase()} />
          <div className="profile-hero-info">
            <div className="profile-title-row">
              <h2>{displayName}</h2>
              <span className={`admin-badge ${profile?.is_admin ? "admin-badge-success" : "admin-badge-neutral"}`}>
                {profile?.is_admin ? "QUẢN TRỊ VIÊN (ADMIN)" : "THÀNH VIÊN"}
              </span>
            </div>
            <p className="profile-id-row">
              <span>Mã ID người dùng:</span>
              <code className="profile-id-code">{userCode}</code>
              <button type="button" className="text-button profile-copy-btn" onClick={() => void copyUserId()}>
                {copiedId ? "✓ Đã sao chép" : "Sao chép"}
              </button>
            </p>
            <p className="profile-contact-summary">
              <span>✉ {profile?.email || session.user.email}</span>
              <span> · </span>
              <span>☎ {profile?.phone || "Chưa cập nhật số điện thoại"}</span>
              {profile?.payments_enabled && (
                <>
                  <span> · </span>
                  <span>✦ {profile.credits} credits</span>
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      <div className="input-grid profile-grid">
        <section className="soft-card input-card">
          <div className="section-heading">
            <span className="step-badge">1</span>
            <div>
              <h2>Thông tin cá nhân</h2>
              <p>Cập nhật họ tên và số điện thoại của bạn</p>
            </div>
          </div>

          <form className="form-stack profile-form" onSubmit={handleSaveInfo}>
            <label className="field-label">
              Họ và tên
              <input
                required
                maxLength={120}
                className="form-input"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Nhập họ và tên của bạn"
                disabled={savingInfo}
              />
            </label>

            <label className="field-label">
              Số điện thoại
              <input
                type="tel"
                maxLength={25}
                className="form-input"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Ví dụ: 0912345678 hoặc +84912345678"
                disabled={savingInfo}
              />
            </label>

            <label className="field-label">
              Địa chỉ Email
              <input type="email" className="form-input" value={profile?.email || session.user.email || ""} readOnly disabled />
              <small className="muted-copy">Đổi email ở mục Đổi email bên dưới để xác nhận bằng mã.</small>
            </label>

            {infoNotice && (
              <p role={infoNotice.error ? "alert" : "status"} className="notice notice-info">
                {infoNotice.text}
              </p>
            )}

            <button type="submit" className="primary-button" disabled={savingInfo || !fullName.trim()}>
              {savingInfo ? "Đang lưu..." : "Lưu thông tin cá nhân"}
            </button>
          </form>
        </section>

        <section className="soft-card input-card">
          <div className="section-heading">
            <span className="step-badge">2</span>
            <div>
              <h2>Đổi mật khẩu</h2>
              <p>Sử dụng mật khẩu mạnh từ 8 ký tự trở lên để bảo vệ tài khoản</p>
            </div>
          </div>

          <form className="form-stack profile-form" onSubmit={handleChangePassword}>
            <label className="field-label">
              Mật khẩu hiện tại
              <input
                required
                type={showPasswords ? "text" : "password"}
                minLength={1}
                maxLength={PASSWORD_MAX_LENGTH}
                className="form-input"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                disabled={savingPassword}
              />
            </label>

            <label className="field-label">
              Mật khẩu mới
              <input
                required
                type={showPasswords ? "text" : "password"}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                className="form-input"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Tối thiểu 8 ký tự"
                disabled={savingPassword}
              />
            </label>

            {newPassword.length > 0 && (
              <div className="profile-strength">
                <div className="profile-strength-head">
                  <span>Độ mạnh mật khẩu</span>
                  <strong>{strength.label}</strong>
                </div>
                <div className="profile-strength-bars" aria-hidden="true">
                  {[1, 2, 3, 4].map((segment) => (
                    <span key={segment} className={strength.score >= segment ? "is-lit" : ""} />
                  ))}
                </div>
              </div>
            )}

            <label className="field-label">
              Nhập lại mật khẩu mới
              <input
                required
                type={showPasswords ? "text" : "password"}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                className="form-input"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Nhập lại mật khẩu mới"
                disabled={savingPassword}
              />
            </label>

            <label className="profile-show-pw">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(event) => setShowPasswords(event.target.checked)}
              />
              <span>Hiện mật khẩu</span>
            </label>

            {passwordNotice && (
              <p role={passwordNotice.error ? "alert" : "status"} className="notice notice-info">
                {passwordNotice.text}
              </p>
            )}

            <button
              type="submit"
              className="primary-button"
              disabled={savingPassword || !currentPassword || newPassword.length < PASSWORD_MIN_LENGTH}
            >
              {savingPassword ? "Đang cập nhật..." : "Đổi mật khẩu"}
            </button>
          </form>
        </section>
      </div>

      <EmailChangeCard />

      <section className="soft-card input-card profile-logout-card">
        <div>
          <h2>Phiên đăng nhập</h2>
          <p className="muted-copy">
            Đăng xuất tài khoản <strong>{profile?.email || session.user.email}</strong> khỏi trình duyệt này.
          </p>
        </div>
        <button type="button" className="secondary-button profile-logout-button" onClick={() => void signOut()}>
          ↪ Đăng xuất khỏi tài khoản
        </button>
      </section>
    </>
  );
}

