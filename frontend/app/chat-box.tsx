"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../utils/api";
import { useApp } from "./app-frame";

type Message = { role: "user" | "assistant"; content: string };

const MESSAGE_LIMIT = 2000;
const STORED_MESSAGES = 40;

// Answered on the spot, so the common questions work even when the AI service does not.
const FAQ = [
  { question: "Làm sao để phân tích CV với JD?", answer: "Vào trang Phân tích. Bước 1: tải CV PDF tối đa 5 MB hoặc chọn CV đã lưu. Bước 2: dán JD (tối thiểu 50 ký tự) hoặc chọn từ trang Việc làm. Sau đó bấm \"Phân tích bằng AI\"." },
  { question: "Làm sao để lưu JD xem sau?", answer: "Vào trang Việc làm, bấm \"☆ Lưu xem sau\" trên tin bạn quan tâm. Xem lại ở tab \"★ Xem sau · Đã lưu\", hoặc mục \"Việc làm xem sau\" trong menu tài khoản (bấm avatar ở góc trên). Bấm \"★ Đã lưu\" để bỏ lưu." },
  { question: "Làm sao để tạo và tải CV?", answer: "Vào trang Tạo CV, chọn mẫu và nhập nội dung; CV tự lưu. Bấm \"Xuất PDF\" để tải về." },
  { question: "Làm sao để luyện phỏng vấn?", answer: "Ở trang Phân tích, chọn CV và JD rồi bấm \"Luyện phỏng vấn nhanh theo JD này\". Bạn có thể nghe câu hỏi, thu âm hoặc gõ câu trả lời, rồi nhận đánh giá." },
  { question: "Làm sao để đổi email, số điện thoại?", answer: "Bấm avatar ở góc trên, chọn \"Hồ sơ cá nhân\". Số điện thoại nằm trong \"Thông tin cá nhân\". Để đổi email, vào mục \"Đổi email\", nhập email mới và mật khẩu, rồi nhập mã xác nhận được gửi tới email mới và email hiện tại." },
  { question: "Đăng xuất ở đâu?", answer: "Bấm avatar ở góc trên bên phải rồi chọn \"Đăng xuất\" ở cuối menu. Trang Hồ sơ cá nhân cũng có nút \"Đăng xuất khỏi tài khoản\"." },
  { question: "CV PDF không tải lên được?", answer: "Kiểm tra file là PDF và không quá 5 MB. PDF dạng ảnh không có lớp văn bản sẽ không đọc được; hãy xuất lại PDF dạng văn bản từ Word hoặc Google Docs, hoặc tạo CV ở trang Tạo CV." }
];

const storageKey = (userId: string) => `cvfit.chat.${userId}`;

function loadMessages(userId: string): Message[] {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey(userId)) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((item): item is Message =>
      (item?.role === "user" || item?.role === "assistant") && typeof item?.content === "string") : [];
  } catch {
    return [];
  }
}

export function clearChat(userId: string) {
  try {
    window.sessionStorage.removeItem(storageKey(userId));
  } catch {
    // Storage can be blocked; nothing was kept in that case.
  }
}

export function ChatBox() {
  const { token, session } = useApp();
  const pathname = usePathname();
  const userId = session.user.id;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(loadMessages(userId));
  }, [userId]);

  useEffect(() => {
    const list = listRef.current;
    if (open && list) list.scrollTop = list.scrollHeight;
  }, [open, messages, busy, error]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function remember(next: Message[]) {
    setMessages(next);
    try {
      window.sessionStorage.setItem(storageKey(userId), JSON.stringify(next.slice(-STORED_MESSAGES)));
    } catch {
      // The conversation still works for this page without storage.
    }
  }

  function askFaq(item: (typeof FAQ)[number]) {
    setError("");
    remember([...messages, { role: "user", content: item.question }, { role: "assistant", content: item.answer }]);
  }

  async function send(content: string) {
    const question = content.trim();
    if (!question || busy) return;
    const asked = [...messages, { role: "user" as const, content: question }];
    remember(asked);
    setText("");
    setError("");
    setBusy(true);
    try {
      const { reply } = await api<{ reply: string }>("/chat", token, {
        method: "POST",
        // Only the section of the site is sent, never the ids in the address.
        body: JSON.stringify({ messages: asked.slice(-STORED_MESSAGES), page: `/${pathname.split("/")[1] ?? ""}` })
      });
      remember([...asked, { role: "assistant", content: reply }]);
    } catch (failure) {
      // The question goes back into the box so it can be sent again.
      remember(messages);
      setText(question);
      setError(failure instanceof Error ? failure.message : "Chưa thể trả lời. Vui lòng thử lại.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(text);
    }
    if (event.key === "Escape") setOpen(false);
  }

  function reset() {
    clearChat(userId);
    setMessages([]);
    setError("");
  }

  if (!open) {
    return <button type="button" className="chat-launcher no-print" aria-label="Mở hỗ trợ sử dụng" title="Hỗ trợ sử dụng" onClick={() => setOpen(true)}>
      <span aria-hidden="true">💬</span>
    </button>;
  }

  // Common questions stay offered when the conversation is empty or the AI could not answer.
  const showFaq = messages.length === 0 || error !== "";

  return <section className="chat-panel no-print" aria-label="Hỗ trợ sử dụng">
    <header className="chat-header">
      <div><strong>Hỗ trợ Job Ready</strong><small>Hỏi cách sử dụng website</small></div>
      <div className="chat-header-actions">
        {messages.length > 0 && <button type="button" className="text-button" disabled={busy} onClick={reset}>Xóa</button>}
        <button type="button" className="chat-close" aria-label="Đóng hỗ trợ sử dụng" onClick={() => setOpen(false)}>×</button>
      </div>
    </header>
    <div ref={listRef} className="chat-messages" role="log" aria-live="polite">
      {messages.map((message, index) => <p key={index} className={`chat-message chat-${message.role}`}>
        <span className="visually-hidden">{message.role === "user" ? "Bạn: " : "Hỗ trợ: "}</span>{message.content}
      </p>)}
      {busy && <p className="chat-message chat-assistant chat-pending">Đang trả lời...</p>}
      {error && <p role="alert" className="chat-error">{error}</p>}
      {showFaq && <div className="chat-empty">
        <p>Câu hỏi thường gặp:</p>
        {FAQ.map((item) => <button key={item.question} type="button" className="chat-suggestion" disabled={busy} onClick={() => askFaq(item)}>{item.question}</button>)}
      </div>}
    </div>
    <form className="chat-form" onSubmit={submit}>
      <textarea ref={inputRef} className="form-input" rows={2} maxLength={MESSAGE_LIMIT} value={text} aria-label="Câu hỏi của bạn"
        placeholder="Nhập câu hỏi..." onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
      <button className="primary-button" disabled={busy || !text.trim()}>Gửi</button>
    </form>
    <small className="chat-disclaimer">Câu hỏi tự nhập được AI trả lời và có thể sai.</small>
  </section>;
}
