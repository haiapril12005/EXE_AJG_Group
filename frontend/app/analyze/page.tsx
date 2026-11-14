"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../utils/api";
import { loadDraft, saveDraft, type DraftJob, type JdDraft } from "../../utils/draft";
import { analysisLabel, type SavedAnalysis, type SavedCv } from "../../utils/history";
import { QualityCard, type QualityEvaluation } from "../analysis-report";
import { useApp } from "../app-frame";
import { useBilling } from "../billing";

type Action = "upload" | "analyze" | "evaluate" | "interview";

const ANALYSIS_STEPS = [
  "Đang phân tích kỹ năng...",
  "Đang bóc tách dự án...",
  "Đang đối chiếu học vấn...",
  "Đang kiểm chứng bằng chứng từ CV...",
  "Sắp xong, đang hoàn thiện báo cáo..."
];

const RECENT_LIMIT = 3;

export default function Home() {
  const { token, refreshProfile } = useApp();
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cvId, setCvId] = useState("");
  const [jd, setJd] = useState("");
  const [job, setJob] = useState<DraftJob | null>(null);
  const [quality, setQuality] = useState<QualityEvaluation | null>(null);
  const [savedCvs, setSavedCvs] = useState<SavedCv[]>([]);
  const [cvTotal, setCvTotal] = useState(0);
  const [pastAnalyses, setPastAnalyses] = useState<SavedAnalysis[]>([]);
  const [questionCount, setQuestionCount] = useState<3 | 5>(3);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const billing = useBilling(null, () => undefined);
  const busy = action !== null;

  useEffect(() => {
    if (action !== "analyze") { setStepIndex(0); return; }
    const timer = window.setInterval(() => setStepIndex((value) => value + 1), 2500);
    return () => window.clearInterval(timer);
  }, [action]);

  function updateDraft(next: JdDraft) {
    setJd(next.text);
    setJob(next.job);
    saveDraft(next);
  }

  async function refreshHistory(): Promise<SavedCv[]> {
    const [cvs, analyses] = await Promise.all([
      api<{ cvs: SavedCv[]; total?: number }>("/cv", token),
      api<{ analyses: SavedAnalysis[] }>("/analyses", token)
    ]);
    setSavedCvs(cvs.cvs);
    setCvTotal(cvs.total ?? cvs.cvs.length);
    setPastAnalyses(analyses.analyses);
    return cvs.cvs;
  }

  useEffect(() => {
    void refreshHistory().then((cvs) => {
      setCvId((current) => current || cvs[0]?.id || "");
    }).catch((error: Error) => setNotice(error.message));
    const draft = loadDraft();
    setJd(draft.text);
    setJob(draft.job);
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId) return;
    window.history.replaceState(null, "", "/analyze");
    void api<{ job: DraftJob & { description: string } }>(`/jobs/${encodeURIComponent(jobId)}`, token)
      .then(({ job: posting }) => updateDraft({
        text: posting.description, job: { id: posting.id, title: posting.title, company: posting.company }
      }))
      .catch((error: Error) => setNotice(error.message));
    // runs once for the signed-in user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSelectedFile(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const result = await api<{ cv_id: string }>("/cv/upload", token, { method: "POST", body: form });
    setCvId(result.cv_id);
    setQuality(null);
    await refreshHistory();
    return result.cv_id;
  }

  async function uploadCV(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile) return;
    setAction("upload");
    setNotice("");
    try {
      await saveSelectedFile(selectedFile);
      setNotice("CV đã được tải lên an toàn. Số điện thoại và email được che trước khi gửi AI.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tải CV.");
    } finally {
      setAction(null);
    }
  }

  function chooseFile(file: File | null) {
    if (file && (file.size > 5 * 1024 * 1024 || !(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")))) {
      setNotice("Vui lòng chọn PDF hợp lệ có dung lượng không quá 5 MB.");
      setSelectedFile(null);
      return;
    }
    setNotice("");
    setSelectedFile(file);
    if (file) {
      setCvId("");
      setQuality(null);
    }
  }

  function chooseSavedCv(id: string) {
    setCvId(id);
    setSelectedFile(null);
    setQuality(null);
  }

  /** The CV to work on: the chosen one, or the selected PDF uploaded on the spot. */
  async function resolveCvId(): Promise<string> {
    const id = cvId || (selectedFile ? await saveSelectedFile(selectedFile) : "");
    if (!id) throw new Error("Hãy chọn CV trước.");
    return id;
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setAction("analyze");
    setNotice("");
    try {
      const id = await resolveCvId();
      const result = await api<{ analysis_id: string }>("/analyze", token, {
        method: "POST",
        body: JSON.stringify({ cv_id: id, jd_text: jd, ...(job ? { job_id: job.id } : {}) })
      });
      await refreshProfile();
      router.push(`/analysis/${result.analysis_id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể phân tích CV.");
      setAction(null);
    }
  }

  async function quickInterview() {
    setAction("interview");
    setNotice("AI đang tạo câu hỏi phỏng vấn theo CV và JD...");
    try {
      const id = await resolveCvId();
      const result = await api<{ session: { id: string } }>("/interviews", token,
        { method: "POST", body: JSON.stringify({ cv_id: id, jd_text: jd, question_count: questionCount }) });
      router.push(`/interview/${result.session.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không tạo được phiên phỏng vấn.");
      setAction(null);
    }
  }

  async function evaluateCv() {
    if (!cvId) return;
    setAction("evaluate");
    setNotice("Đang đánh giá chất lượng CV...");
    try {
      setQuality(await api<QualityEvaluation>(`/cv/${cvId}/evaluate`, token, { method: "POST", body: JSON.stringify({}) }));
      setNotice("Đã hoàn tất đánh giá CV độc lập với JD.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể đánh giá CV.");
    } finally {
      setAction(null);
    }
  }

  const uploaded = !!selectedFile && !!cvId;
  const canUseCv = !!cvId || !!selectedFile;
  const jdReady = jd.trim().length >= 50;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">BƯỚC TIẾP THEO TRONG SỰ NGHIỆP CỦA BẠN</p>
        <h1>Tối Ưu Hóa Hồ Sơ<br /><span>Chinh Phục Nhà Tuyển Dụng</span></h1>
        <p>Hệ thống AI tự động đối chiếu CV với JD, xác định chính xác những điểm còn thiếu và gợi ý cách cải thiện hồ sơ.</p>
      </section>

      {notice && <p role="status" className="notice notice-info no-print">{notice}</p>}
      {billing.panel}

      <section className="input-grid" aria-label="Thông tin CV và mô tả công việc">
        <section className="soft-card input-card">
          <div className="section-heading">
            <span className="step-badge">1</span>
            <div><h2>Chọn CV</h2><p>Tải PDF tối đa 5 MB hoặc dùng CV đã lưu</p></div>
          </div>
          <form onSubmit={uploadCV}>
            <button
              type="button"
              className="drop-area"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <span className="upload-icon" aria-hidden="true">↑</span>
              <strong>{selectedFile?.name || "Kéo thả file CV vào đây"}</strong>
              <span>Định dạng hỗ trợ: PDF · tối đa 5 MB</span>
              <span className="choose-file">Chọn file</span>
            </button>
            <input ref={fileRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
            {selectedFile && (
              <div className="file-status">
                <span className="file-icon">PDF</span>
                <span className="file-info"><strong>{selectedFile.name}</strong><small>{uploaded ? "Đã tải lên an toàn" : `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Sẵn sàng tải lên`}</small></span>
                <span className="status-check" aria-label={uploaded ? "Đã tải lên" : "Sẵn sàng"}>{uploaded ? "✓" : "•"}</span>
              </div>
            )}
            <p className="privacy-note">Thông tin liên hệ sẽ được che trước khi gửi AI.</p>
            {selectedFile && !uploaded && <button disabled={busy} className="secondary-button">{action === "upload" ? "Đang xử lý PDF..." : "Tải CV lên"}</button>}
          </form>
          <div className="cv-alt-actions">
            {savedCvs.length > 0 && <label className="field-label">CV đã lưu
              <select className="form-input" value={cvId} disabled={busy} onChange={(event) => chooseSavedCv(event.target.value)}>
                <option value="">— Chọn CV —</option>
                {savedCvs.map((item) => <option key={item.id} value={item.id}>{item.original_name}</option>)}
              </select>
            </label>}
            {cvTotal > savedCvs.length && <p className="muted-copy field-hint">Đang hiện {savedCvs.length}/{cvTotal} CV gần nhất. <Link href="/history" className="inline-link">Mở CV cũ hơn trong Lịch sử</Link></p>}
            {cvId && <Link href={`/cv/${cvId}`} className="secondary-button link-button">✎ Chỉnh sửa CV trên web</Link>}
            {cvId && <button type="button" disabled={busy} className="secondary-button" onClick={() => void evaluateCv()}>◎ Đánh giá chất lượng CV</button>}
            <Link href="/create" className="secondary-button link-button">＋ Hoặc tạo CV mới từ form</Link>
          </div>
        </section>

        <section className="soft-card input-card">
          <div className="section-heading">
            <span className="step-badge">2</span>
            <div><h2>Chọn mô tả công việc (JD)</h2><p>Dán nội dung tuyển dụng hoặc <Link href="/jobs" className="inline-link">chọn từ kho việc làm</Link></p></div>
          </div>
          <form onSubmit={analyze}>
            {job && <p className="job-chip">Đang dùng JD: <strong>{job.title}</strong> · {job.company} <button type="button" className="text-button" disabled={busy} onClick={() => updateDraft({ text: "", job: null })}>Bỏ chọn</button></p>}
            <textarea
              required
              minLength={50}
              maxLength={20000}
              value={jd}
              // An edited JD no longer matches the posting, so the job link is dropped.
              onChange={(event) => updateDraft({ text: event.target.value, job: null })}
              placeholder="Hãy dán nội dung tuyển dụng (JD) mà bạn muốn ứng tuyển vào đây..."
              className="jd-input"
            />
            <div className="input-meta"><span>Tối thiểu 50 ký tự</span><span>{jd.length.toLocaleString("vi-VN")}/20.000</span></div>
            <button disabled={!canUseCv || !jdReady || busy || billing.paying} className="primary-button analyze-button">
              <span aria-hidden="true">✦</span>{action === "analyze" ? ANALYSIS_STEPS[stepIndex % ANALYSIS_STEPS.length] : "Phân tích bằng AI"}
            </button>
            <div className="quick-interview-row">
              <button type="button" disabled={!canUseCv || !jdReady || busy} className="secondary-button quick-interview-button" onClick={() => void quickInterview()}>
                {action === "interview" ? "Đang tạo câu hỏi..." : "🎙 Luyện phỏng vấn nhanh theo JD này"}
              </button>
              <label className="question-count">Số câu
                <select className="form-input" value={questionCount} disabled={busy} onChange={(event) => setQuestionCount(event.target.value === "5" ? 5 : 3)}>
                  <option value="3">3 câu</option>
                  <option value="5">5 câu</option>
                </select>
              </label>
            </div>
          </form>
        </section>
      </section>

      {quality && <QualityCard quality={quality} />}

      {(savedCvs.length > 0 || pastAnalyses.length > 0) && <section className="history-section no-print">
        <div className="history-heading"><h2>Hồ sơ và báo cáo gần đây</h2><Link href="/history" className="inline-link">Xem tất cả</Link></div>
        <div className="history-grid">
          <section className="soft-card"><h3>CV đã lưu</h3>
            {savedCvs.slice(0, RECENT_LIMIT).map((item) => <Link key={item.id} href={`/cv/${item.id}`} className="history-item">
              <strong>{item.original_name}</strong><small>{new Date(item.created_at).toLocaleDateString("vi-VN")}</small>
            </Link>)}
          </section>
          <section className="soft-card"><h3>Phân tích đã lưu</h3>
            {pastAnalyses.slice(0, RECENT_LIMIT).map((item) => <Link key={item.id} href={`/analysis/${item.id}`} className="history-item">
              <strong>Phù hợp {item.rci_score}%</strong><small>{new Date(item.created_at).toLocaleDateString("vi-VN")} · {analysisLabel(item)}</small>
            </Link>)}
          </section>
        </div>
      </section>}
    </>
  );
}
