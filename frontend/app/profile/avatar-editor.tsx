"use client";

import { useRef, useState } from "react";
import { api } from "../../utils/api";
import { AVATAR_SIZE, imageFileToDataUrl } from "../../utils/image";
import { useApp } from "../app-frame";

/** The profile picture with buttons to upload, change or remove it. */
export function AvatarEditor({ letter }: { letter: string }) {
  const { token, profile, refreshProfile } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const avatar = profile?.avatar ?? null;

  async function save(next: string) {
    setBusy(true);
    setNotice(null);
    try {
      await api("/user/avatar", token, { method: "PUT", body: JSON.stringify({ avatar: next }) });
      await refreshProfile();
      setNotice({ text: next ? "Đã cập nhật ảnh đại diện." : "Đã xóa ảnh đại diện.", error: false });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Không lưu được ảnh đại diện.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function choose(file: File) {
    try {
      await save(await imageFileToDataUrl(file, AVATAR_SIZE));
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Không xử lý được ảnh.", error: true });
    }
  }

  return <div className="profile-avatar-editor">
    {avatar
      ? <img className="profile-avatar-lg avatar-photo" src={avatar} alt="Ảnh đại diện" />
      : <span className="profile-avatar-lg" aria-hidden="true">{letter}</span>}
    <div className="profile-avatar-actions">
      <button type="button" className="text-button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Đang lưu..." : avatar ? "Đổi ảnh" : "Tải ảnh lên"}
      </button>
      {avatar && <button type="button" className="text-button" disabled={busy} onClick={() => void save("")}>Xóa</button>}
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" tabIndex={-1}
      aria-label="Chọn ảnh đại diện" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void choose(file);
      }} />
    {notice && <p role={notice.error ? "alert" : "status"} className={`profile-avatar-notice ${notice.error ? "is-error" : ""}`}>{notice.text}</p>}
  </div>;
}
