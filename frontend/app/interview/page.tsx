"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../../utils/supabase/client";
import "../workspace.css";
import "./interview.css";

const supabase = createClient();
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

type Feedback = {
  score: number;
  strengths: { claim: string; quote: string }[];
  improvements: { finding: string; suggestion: string; answer_quote: string | null }[];
};
type Answer = { question_index: number; answer_text: string; evaluation: Feedback };
type Interview = {
  id: string;
  questions: string[];
  status: "IN_PROGRESS" | "COMPLETED";
  answers: Answer[];
  overall_score: number | null;
};

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`, ...init?.headers }
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Yêu cầu không thể hoàn tất.");
  return payload as T;
}

export default function InterviewPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [interview, setInterview] = useState<Interview | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const id = new URLSearchParams(window.location.search).get("id");
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session && id) {
        try {
          const result = await api<{ session: Interview }>(`/interviews/${id}`, data.session.access_token);
          if (!active) return;
          setInterview(result.session);
          const next = result.session.questions.findIndex((_, questionIndex) =>
            !result.session.answers.some((item) => item.question_index === questionIndex));
          setIndex(next < 0 ? 0 : next);
        } catch (error) {
          if (active) setNotice(error instanceof Error ? error.message : "Không mở được phiên phỏng vấn.");
        }
      } else if (!id) setNotice("Thiếu mã phiên phỏng vấn.");
      if (active) setReady(true);
    });
    return () => {
      active = false;
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const currentAnswer = interview?.answers.find((item) => item.question_index === index);
  const question = interview?.questions[index];

  async function playQuestion() {
    if (!session || !interview) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${API_URL}/api/interviews/${interview.id}/questions/${index}/audio`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Không tạo được giọng đọc.");
      }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không phát được câu hỏi.");
    } finally {
      setBusy(false);
    }
  }

  async function transcribe(blob: Blob) {
    if (!session || !interview) return;
    setBusy(true);
    setNotice("Đang chuyển giọng nói thành văn bản...");
    try {
      const form = new FormData();
      const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `answer.${extension}`);
      const result = await api<{ transcript: string }>(`/interviews/${interview.id}/transcribe`,
        session.access_token, { method: "POST", body: form });
      setAnswer(result.transcript);
      setNotice("Đã chép lời. Bạn có thể sửa văn bản trước khi nộp.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không nhận diện được lời nói.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Trình duyệt này không hỗ trợ thu âm. Bạn có thể gõ câu trả lời.");
      return;
    }
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm", "audio/ogg", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const audioBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (audioBlob.size) void transcribe(audioBlob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setNotice("Đang thu âm; tối đa 90 giây.");
      timeoutRef.current = window.setTimeout(() => stopRecording(), 90_000);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setNotice("Không mở được microphone. Hãy cấp quyền hoặc gõ câu trả lời.");
    } finally {
      setBusy(false);
    }
  }

  function stopRecording() {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function submitAnswer() {
    if (!session || !interview || answer.trim().length < 20) return;
    setBusy(true);
    setNotice("AI đang đánh giá câu trả lời...");
    try {
      await api(`/interviews/${interview.id}/answers`, session.access_token, {
        method: "POST", body: JSON.stringify({ question_index: index, answer_text: answer.trim() })
      });
      const result = await api<{ session: Interview }>(`/interviews/${interview.id}`, session.access_token);
      setInterview(result.session);
      setNotice("Đã lưu đánh giá câu trả lời.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không đánh giá được câu trả lời.");
    } finally {
      setBusy(false);
    }
  }

  function selectQuestion(next: number) {
    setIndex(next);
    setAnswer("");
    setNotice("");
  }

  if (!ready) return <main className="interview-shell"><p>Đang tải phiên phỏng vấn...</p></main>;
  if (!session) return <main className="interview-shell"><p>Hãy <a href="/">đăng nhập</a> để luyện phỏng vấn.</p></main>;

  return <main className="interview-shell">
    <header className="interview-header"><a href="/">← Về trang chính</a><strong>AI Career Ready · Mock Interview</strong></header>
    <section className="interview-intro">
      <p className="eyebrow">LUYỆN PHỎNG VẤN</p>
      <h1>Trả lời câu hỏi theo CV và JD của bạn</h1>
      <p>Nghe câu hỏi, thu âm hoặc gõ câu trả lời. Bạn có thể sửa bản chép lời trước khi nộp. Giọng đọc câu hỏi do AI tạo.</p>
    </section>
    {notice && <p role="status" className="notice notice-info">{notice}</p>}
    {interview && question && <>
      <nav className="interview-progress" aria-label="Câu hỏi phỏng vấn">
        {interview.questions.map((_, questionIndex) => <button key={questionIndex}
          type="button" disabled={busy || recording} className={index === questionIndex ? "is-current" : ""}
          onClick={() => selectQuestion(questionIndex)}>
          Câu {questionIndex + 1}{interview.answers.some((item) => item.question_index === questionIndex) ? " ✓" : ""}
        </button>)}
      </nav>
      <section className="interview-card">
        <span className="question-label">CÂU HỎI {index + 1}/3</span>
        <h2>{question}</h2>
        <button type="button" className="secondary-button" onClick={() => void playQuestion()} disabled={busy}>🔊 Nghe câu hỏi</button>
      </section>
      {currentAnswer ? <section className="interview-card">
        <h2>Câu trả lời đã nộp</h2>
        <p className="interview-answer">{currentAnswer.answer_text}</p>
        <div className="feedback-score">Điểm: <strong>{currentAnswer.evaluation.score}/100</strong></div>
        <h3>Điểm mạnh</h3>
        {currentAnswer.evaluation.strengths.length ? currentAnswer.evaluation.strengths.map((item, i) =>
          <p key={i}>✓ {item.claim} <small>“{item.quote}”</small></p>) : <p>Chưa có điểm mạnh nổi bật được AI xác nhận.</p>}
        <h3>Cần cải thiện</h3>
        {currentAnswer.evaluation.improvements.map((item, i) =>
          <p key={i}>• {item.finding} — {item.suggestion}{item.answer_quote && <small> “{item.answer_quote}”</small>}</p>)}
        {index < 2 && <button type="button" className="primary-button" disabled={busy || recording} onClick={() => selectQuestion(index + 1)}>Câu tiếp theo →</button>}
      </section> : <section className="interview-card">
        <h2>Câu trả lời của bạn</h2>
        <div className="interview-actions">
          <button type="button" className="secondary-button" onClick={() => recording ? stopRecording() : void startRecording()} disabled={busy}>
            {recording ? "■ Dừng thu âm" : "🎙 Thu âm câu trả lời"}
          </button>
          <span>hoặc nhập văn bản bên dưới</span>
        </div>
        <textarea className="jd-input" value={answer} onChange={(event) => setAnswer(event.target.value)}
          placeholder="Nhập câu trả lời hoặc dùng microphone..." maxLength={5000} rows={8} />
        <p className="interview-hint">Tối thiểu 20 ký tự · {answer.length}/5.000</p>
        <button type="button" className="primary-button" onClick={() => void submitAnswer()}
          disabled={busy || recording || answer.trim().length < 20}>Nộp và nhận đánh giá</button>
      </section>}
      {interview.status === "COMPLETED" && <section className="interview-card interview-finish">
        <h2>Hoàn thành phiên phỏng vấn</h2>
        <p>Điểm trung bình: <strong>{interview.overall_score ?? "—"}/100</strong></p>
        <p>Xem lại từng câu để đọc góp ý và luyện trả lời tốt hơn.</p>
      </section>}
    </>}
  </main>;
}
