"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, API_URL } from "../../../utils/api";
import { useApp } from "../../app-frame";
import "../interview.css";

type Feedback = {
  score: number;
  strengths: { claim: string; quote: string }[];
  improvements: { finding: string; suggestion: string; answer_quote: string | null }[];
  follow_up_question?: string | null;
};
type FollowUp = { question: string; answer_text: string; evaluation: Feedback; created_at?: string };
type Attempt = { answer_text: string; evaluation: Feedback; follow_up?: FollowUp | null; created_at?: string | null };
type Answer = {
  question_index: number;
  answer_text: string;
  evaluation: Feedback;
  created_at?: string;
  previous_attempts?: Attempt[];
  follow_up?: FollowUp | null;
};
type Interview = {
  id: string;
  analysis_id: string | null;
  questions: string[];
  status: "IN_PROGRESS" | "COMPLETED";
  answers: Answer[];
  overall_score: number | null;
};
/** Which text box a recording fills: the main answer or the reply to the follow-up. */
type Target = "main" | "follow";

const MIN_ANSWER = 20;
const MAX_RECORDING_MS = 90_000;

function FeedbackView({ feedback }: { feedback: Feedback }) {
  return <>
    <div className="feedback-score">Điểm: <strong>{feedback.score}/100</strong></div>
    <h3>Điểm mạnh</h3>
    {feedback.strengths.length ? feedback.strengths.map((item, i) =>
      <p key={i}>✓ {item.claim} <small>“{item.quote}”</small></p>) : <p>Chưa có điểm mạnh nổi bật được AI xác nhận.</p>}
    <h3>Cần cải thiện</h3>
    {feedback.improvements.length ? feedback.improvements.map((item, i) =>
      <p key={i}>• {item.finding} — {item.suggestion}{item.answer_quote && <small> “{item.answer_quote}”</small>}</p>)
      : <p>Không có góp ý thêm.</p>}
  </>;
}

function scoreChange(current: number, previous: number) {
  const diff = current - previous;
  return diff === 0 ? "không đổi" : diff > 0 ? `+${diff}` : String(diff);
}

export default function InterviewPage() {
  const { token } = useApp();
  const { id } = useParams<{ id: string }>();
  const [ready, setReady] = useState(false);
  const [interview, setInterview] = useState<Interview | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [followAnswer, setFollowAnswer] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [recording, setRecording] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);
  // Replaying a question reuses its clip instead of asking the server again.
  const audioRef = useRef(new Map<string, string>());

  useEffect(() => {
    let active = true;
    const audio = audioRef.current;
    void (async () => {
      try {
        const result = await api<{ session: Interview }>(`/interviews/${id}`, token);
        if (!active) return;
        setInterview(result.session);
        const next = result.session.questions.findIndex((_, questionIndex) =>
          !result.session.answers.some((item) => item.question_index === questionIndex));
        setIndex(next < 0 ? 0 : next);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Không mở được phiên phỏng vấn.");
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audio.forEach((url) => URL.revokeObjectURL(url));
      audio.clear();
    };
    // A refreshed token must not reload the session over an answer in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const currentAnswer = interview?.answers.find((item) => item.question_index === index);
  const question = interview?.questions[index];
  const followUpQuestion = currentAnswer?.evaluation.follow_up_question ?? null;

  async function reload(current: Interview) {
    const result = await api<{ session: Interview }>(`/interviews/${current.id}`, token);
    setInterview(result.session);
  }

  async function playQuestion(followUp: boolean) {
    if (!interview) return;
    const text = followUp ? followUpQuestion : question;
    if (!text) return;
    setBusy(true);
    setNotice("");
    try {
      const key = `${index}|${text}`;
      let url = audioRef.current.get(key);
      if (!url) {
        const response = await fetch(`${API_URL}/api/interviews/${interview.id}/questions/${index}/audio${followUp ? "?follow_up=1" : ""}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error || "Không tạo được giọng đọc.");
        }
        url = URL.createObjectURL(await response.blob());
        audioRef.current.set(key, url);
      }
      await new Audio(url).play();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không phát được câu hỏi.");
    } finally {
      setBusy(false);
    }
  }

  async function transcribe(blob: Blob, target: Target) {
    if (!interview) return;
    setBusy(true);
    setNotice("Đang chuyển giọng nói thành văn bản...");
    try {
      const form = new FormData();
      const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `answer.${extension}`);
      const result = await api<{ transcript: string }>(`/interviews/${interview.id}/transcribe`,
        token, { method: "POST", body: form });
      (target === "main" ? setAnswer : setFollowAnswer)(result.transcript);
      setNotice("Đã chép lời. Bạn có thể sửa văn bản trước khi nộp.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không nhận diện được lời nói.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording(target: Target) {
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
        if (audioBlob.size) void transcribe(audioBlob, target);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(target);
      setNotice("Đang thu âm; tối đa 90 giây.");
      timeoutRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
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
    setRecording(null);
  }

  async function submitAnswer() {
    if (!interview || answer.trim().length < MIN_ANSWER) return;
    setBusy(true);
    setNotice("AI đang đánh giá câu trả lời...");
    try {
      await api(`/interviews/${interview.id}/answers`, token, {
        method: "POST", body: JSON.stringify({ question_index: index, answer_text: answer.trim() })
      });
      await reload(interview);
      setAnswer("");
      setFollowAnswer("");
      setRetrying(false);
      setNotice("Đã lưu đánh giá câu trả lời.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không đánh giá được câu trả lời.");
    } finally {
      setBusy(false);
    }
  }

  async function submitFollowUp() {
    if (!interview || followAnswer.trim().length < MIN_ANSWER) return;
    setBusy(true);
    setNotice("AI đang đánh giá câu trả lời nối tiếp...");
    try {
      await api(`/interviews/${interview.id}/answers/${index}/follow-up`, token, {
        method: "POST", body: JSON.stringify({ answer_text: followAnswer.trim() })
      });
      await reload(interview);
      setFollowAnswer("");
      setNotice("Đã lưu đánh giá câu trả lời nối tiếp.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không đánh giá được câu trả lời nối tiếp.");
    } finally {
      setBusy(false);
    }
  }

  function selectQuestion(next: number) {
    setIndex(next);
    setAnswer("");
    setFollowAnswer("");
    setRetrying(false);
    setNotice("");
  }

  function retryQuestion() {
    setAnswer(currentAnswer?.answer_text ?? "");
    setRetrying(true);
    setNotice("");
  }

  function recordButton(target: Target) {
    return <button type="button" className="secondary-button" disabled={busy || (recording !== null && recording !== target)}
      onClick={() => recording === target ? stopRecording() : void startRecording(target)}>
      {recording === target ? "■ Dừng thu âm" : "🎙 Thu âm câu trả lời"}
    </button>;
  }

  if (!ready) return <p className="muted-copy">Đang tải phiên phỏng vấn...</p>;

  const total = interview?.questions.length ?? 0;
  const locked = busy || recording !== null;
  const attempts = currentAnswer?.previous_attempts ?? [];
  const lastAttempt = attempts[attempts.length - 1];
  return <div className="practice-shell">
    <section className="practice-intro">
      <p className="eyebrow">LUYỆN PHỎNG VẤN</p>
      <h1>Trả lời câu hỏi theo CV và JD của bạn</h1>
      <p>Nghe câu hỏi, thu âm hoặc gõ câu trả lời. Sau mỗi câu, người phỏng vấn AI có thể hỏi tiếp để đào sâu. Bạn có thể sửa bản chép lời trước khi nộp. Giọng đọc câu hỏi do AI tạo.</p>
      {interview?.analysis_id && <Link href={`/analysis/${interview.analysis_id}`} className="inline-link">← Về báo cáo phân tích</Link>}
    </section>
    {notice && <p role="status" className="notice notice-info">{notice}</p>}
    {interview && question && <>
      <nav className="practice-progress" aria-label="Câu hỏi phỏng vấn">
        {interview.questions.map((_, questionIndex) => <button key={questionIndex}
          type="button" disabled={locked} className={index === questionIndex ? "is-current" : ""}
          onClick={() => selectQuestion(questionIndex)}>
          Câu {questionIndex + 1}{interview.answers.some((item) => item.question_index === questionIndex) ? " ✓" : ""}
        </button>)}
      </nav>
      <section className="practice-card">
        <span className="question-label">CÂU HỎI {index + 1}/{total}</span>
        <h2>{question}</h2>
        <button type="button" className="secondary-button" onClick={() => void playQuestion(false)} disabled={busy}>🔊 Nghe câu hỏi</button>
      </section>
      {currentAnswer && !retrying ? <>
        <section className="practice-card">
          <h2>Câu trả lời đã nộp</h2>
          {lastAttempt && <p className="practice-progress-note">Lần {attempts.length + 1} · so với lần trước: {lastAttempt.evaluation.score} → <strong>{currentAnswer.evaluation.score}</strong> ({scoreChange(currentAnswer.evaluation.score, lastAttempt.evaluation.score)})</p>}
          <p className="practice-answer">{currentAnswer.answer_text}</p>
          <FeedbackView feedback={currentAnswer.evaluation} />
          {attempts.length > 0 && <details className="practice-attempts">
            <summary>Các lần trả lời trước ({attempts.length})</summary>
            {[...attempts].reverse().map((attempt, i) => <article key={i} className="practice-attempt">
              <strong>Lần {attempts.length - i} · {attempt.evaluation.score}/100{attempt.created_at ? ` · ${new Date(attempt.created_at).toLocaleString("vi-VN")}` : ""}</strong>
              <p className="practice-answer">{attempt.answer_text}</p>
              <FeedbackView feedback={attempt.evaluation} />
            </article>)}
          </details>}
          <div className="practice-actions">
            <button type="button" className="secondary-button" disabled={locked} onClick={retryQuestion}>↻ Trả lời lại câu này</button>
            {index < total - 1 && <button type="button" className="primary-button" disabled={locked} onClick={() => selectQuestion(index + 1)}>Câu tiếp theo →</button>}
          </div>
        </section>
        {followUpQuestion && <section className="practice-card practice-follow-up" aria-label="Câu hỏi nối tiếp">
          <span className="question-label">NGƯỜI PHỎNG VẤN HỎI TIẾP</span>
          <h2>{followUpQuestion}</h2>
          <button type="button" className="secondary-button" onClick={() => void playQuestion(true)} disabled={busy}>🔊 Nghe câu hỏi nối tiếp</button>
          {currentAnswer.follow_up ? <>
            <h3>Câu trả lời của bạn</h3>
            <p className="practice-answer">{currentAnswer.follow_up.answer_text}</p>
            <FeedbackView feedback={currentAnswer.follow_up.evaluation} />
          </> : <>
            <div className="practice-actions">
              {recordButton("follow")}
              <span>hoặc nhập văn bản bên dưới</span>
            </div>
            <textarea className="jd-input" value={followAnswer} onChange={(event) => setFollowAnswer(event.target.value)}
              aria-label="Câu trả lời cho câu hỏi nối tiếp" placeholder="Trả lời câu hỏi nối tiếp..." maxLength={5000} rows={6} />
            <p className="practice-hint">Tối thiểu {MIN_ANSWER} ký tự · {followAnswer.length}/5.000 · Không tính vào điểm trung bình của phiên</p>
            <div className="practice-actions">
              <button type="button" className="primary-button" onClick={() => void submitFollowUp()}
                disabled={locked || followAnswer.trim().length < MIN_ANSWER}>Nộp câu trả lời nối tiếp</button>
            </div>
          </>}
        </section>}
      </> : <section className="practice-card">
        <h2>{retrying ? "Trả lời lại" : "Câu trả lời của bạn"}</h2>
        {retrying && <p className="practice-hint">Lần trả lời hiện tại được giữ lại trong lịch sử để bạn so sánh điểm.</p>}
        <div className="practice-actions">
          {recordButton("main")}
          <span>hoặc nhập văn bản bên dưới</span>
        </div>
        <textarea className="jd-input" value={answer} onChange={(event) => setAnswer(event.target.value)}
          aria-label="Câu trả lời" placeholder="Nhập câu trả lời hoặc dùng microphone..." maxLength={5000} rows={8} />
        <p className="practice-hint">Tối thiểu {MIN_ANSWER} ký tự · {answer.length}/5.000</p>
        <div className="practice-actions">
          <button type="button" className="primary-button" onClick={() => void submitAnswer()}
            disabled={locked || answer.trim().length < MIN_ANSWER}>Nộp và nhận đánh giá</button>
          {retrying && <button type="button" className="secondary-button" disabled={locked} onClick={() => { setRetrying(false); setAnswer(""); }}>Hủy</button>}
        </div>
      </section>}
      {interview.status === "COMPLETED" && <section className="practice-card practice-finish">
        <h2>Hoàn thành phiên phỏng vấn</h2>
        <p>Điểm trung bình: <strong>{interview.overall_score ?? "—"}/100</strong></p>
        <p>Xem lại từng câu để đọc góp ý, trả lời câu hỏi nối tiếp và luyện trả lời tốt hơn.</p>
      </section>}
    </>}
  </div>;
}
