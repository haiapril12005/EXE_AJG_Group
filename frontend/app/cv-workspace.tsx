"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../utils/api";
import { loadDraft } from "../utils/draft";
import { AnalysisReport, QualityCard, type Analysis, type QualityEvaluation } from "./analysis-report";
import { useApp } from "./app-frame";
import { useBilling } from "./billing";
import { CV_TEMPLATES, CvPaper, TEMPLATE_CATEGORIES, type CvData, type CvTemplateId, type RewriteSection } from "./cv-editor";

type SavedAnalysis = Analysis & { cv_id: string; jd_text: string; job_id?: string | null };
type UndoEntry = { section: RewriteSection; index: number; previous: string };
type EvaluateResult = QualityEvaluation & { evaluation_id: string };

const STRUCTURE_FAILED_NOTICE = "AI chưa bóc tách được CV này nên nội dung đang tạm nằm ở phần Mục tiêu nghề nghiệp. Tải lại trang để thử lại; nếu bạn sửa CV, bản đang sửa sẽ được lưu.";
// The rewrite endpoint accepts a 2,000-character hint.
const SUGGESTION_LIMIT = 1900;

export function CvWorkspace({ cvId: routeCvId, analysisId, evaluationId }: { cvId?: string; analysisId?: string; evaluationId?: string }) {
  const { token, profile, refreshProfile } = useApp();
  const router = useRouter();
  const [cvId, setCvId] = useState(routeCvId ?? "");
  const [jd, setJd] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [quality, setQuality] = useState<QualityEvaluation | null>(null);
  const [evaluations, setEvaluations] = useState<QualityEvaluation[]>([]);
  const [cvData, setCvData] = useState<CvData | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [prevScore, setPrevScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const cvRef = useRef<CvData | null>(null);
  const dirtyRef = useRef(false);
  const saveTarget = useRef({ token, cvId });
  const loaded = useRef(false);
  const billing = useBilling(analysis && !analysis.layer_4_mock ? analysis.analysis_id : null, (unlocked) => {
    setAnalysis((current) => current && { ...current, layer_4_mock: unlocked.layer_4_mock,
      is_premium_unlocked: true, credits_remaining: unlocked.credits_remaining });
  });

  useEffect(() => {
    saveTarget.current = { token, cvId };
  }, [token, cvId]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        let id = routeCvId ?? "";
        if (analysisId) {
          const { analysis: saved } = await api<{ analysis: SavedAnalysis }>(`/analyses/${analysisId}`, token);
          id = saved.cv_id;
          setAnalysis(saved);
          setJd(saved.jd_text);
          setJobId(saved.job_id ?? null);
        } else {
          const draft = loadDraft();
          setJd(draft.text);
          setJobId(draft.job?.id ?? null);
        }
        const result = await api<{ cv_data: CvData; structured?: boolean }>(`/cv/${id}`, token);
        setCvId(id);
        setCvData(result.cv_data);
        if (result.structured === false) setNotice(STRUCTURE_FAILED_NOTICE);
        // Past quality checks are a convenience: the CV still opens if they cannot be read.
        void api<{ evaluations: QualityEvaluation[] }>(`/cv/${id}/evaluations`, token).then(({ evaluations: saved }) => {
          setEvaluations(saved);
          // The CV page opens on the chosen or latest check; a report page keeps the report in front.
          const chosen = saved.find((item) => item.id === evaluationId) ?? (analysisId ? undefined : saved[0]);
          if (chosen) setQuality(chosen);
        }).catch(() => undefined);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Không thể mở CV.");
      } finally {
        setLoading(false);
      }
    })();
    // A refreshed token must not reload the CV over edits in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function flushSave(): Promise<void> {
    const target = saveTarget.current;
    if (!target.cvId || !dirtyRef.current || !cvRef.current) return;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      await api(`/cv/${target.cvId}`, target.token, { method: "PUT", body: JSON.stringify({ cv_data: cvRef.current }) });
      setSaveState(dirtyRef.current ? "dirty" : "saved");
    } catch (error) {
      dirtyRef.current = true;
      setSaveState("error");
      throw error;
    }
  }

  useEffect(() => {
    cvRef.current = cvData;
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => { void flushSave().catch(() => undefined); }, 1200);
    return () => window.clearTimeout(timer);
    // flushSave reads the latest values through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvData]);

  useEffect(() => () => {
    // Leaving the page cancels the autosave timer, so save what is still pending.
    void flushSave().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeCv(next: CvData) {
    dirtyRef.current = true;
    setSaveState("dirty");
    setCvData(next);
  }

  function setDescription(section: RewriteSection, index: number, value: string) {
    dirtyRef.current = true;
    setSaveState("dirty");
    setCvData((current) => {
      if (!current) return current;
      if (section === "summary") return { ...current, summary: value };
      return { ...current, [section]: current[section].map((item, i) => (i === index ? { ...item, description: value } : item)) } as CvData;
    });
  }

  function typeInto(section: RewriteSection, index: number, text: string): Promise<void> {
    return new Promise((resolve) => {
      let position = 0;
      const timer = window.setInterval(() => {
        position = Math.min(text.length, position + 4);
        setDescription(section, index, text.slice(0, position));
        if (position >= text.length) {
          window.clearInterval(timer);
          resolve();
        }
      }, 16);
    });
  }

  function suggestionFor(section: RewriteSection, index: number): string {
    const missing = analysis?.requirements?.length
      ? analysis.requirements.filter((item) => !item.matched).map((item) => item.jd_quote)
      : analysis?.layer_1_skills.missing ?? [];
    const fallback = missing.length
      ? `Làm nổi bật các yêu cầu của JD mà mục này có thể chứng minh bằng thông tin sẵn có (JD đang thiếu: ${missing.join("; ")}). Không thêm công nghệ hay kinh nghiệm chưa có.`
      : "Làm nổi bật các điểm phù hợp nhất với JD bằng thông tin sẵn có.";
    if (section !== "projects" || !analysis || !cvRef.current) return fallback.slice(0, SUGGESTION_LIMIT);
    const name = cvRef.current.projects[index]?.name.trim().toLowerCase();
    const match = name ? analysis.layer_2_projects.find((item) => {
      const candidate = item.project_name.trim().toLowerCase();
      return candidate.includes(name) || name.includes(candidate);
    }) : undefined;
    return (match ? `${match.issue}. ${match.suggestion}` : fallback).slice(0, SUGGESTION_LIMIT);
  }

  /** A batch keeps every rewrite undoable; a single rewrite replaces the previous undo. */
  async function rewriteOne(section: RewriteSection, index: number, suggestion?: string, batch = false) {
    if (!cvRef.current) return;
    if (jd.trim().length < 20) {
      setNotice("Hãy dán JD trước khi nhờ AI viết lại.");
      return;
    }
    const cv = cvRef.current;
    const current = section === "summary"
      ? { description: cv.summary }
      : section === "experience"
        ? cv.experience[index]
        : cv.projects[index];
    if (!current) return;
    const key = `${section}-${index}`;
    setRewriting(key);
    setNotice("");
    try {
      const result = await api<{ new_description: string }>("/ai/rewrite-section", token, {
        method: "POST",
        body: JSON.stringify({
          jd_text: jd,
          section_type: section,
          current_section_data: current,
          ai_suggestion: (suggestion ?? suggestionFor(section, index)).slice(0, SUGGESTION_LIMIT)
        })
      });
      const entry = { section, index, previous: current.description };
      setUndo((entries) => batch ? [...entries, entry] : [entry]);
      setHighlights((keys) => batch ? [...keys, key] : [key]);
      await typeInto(section, index, result.new_description);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI chưa thể viết lại mục này.");
    } finally {
      setRewriting(null);
    }
  }

  async function optimizeAll() {
    const cv = cvRef.current;
    if (!cv) return;
    const targets: [RewriteSection, number][] = [];
    if (cv.summary.trim()) targets.push(["summary", 0]);
    cv.projects.forEach((item, index) => { if (item.description.trim()) targets.push(["projects", index]); });
    cv.experience.forEach((item, index) => { if (item.description.trim()) targets.push(["experience", index]); });
    setUndo([]);
    setHighlights([]);
    for (const [section, index] of targets) await rewriteOne(section, index, undefined, true);
  }

  function revertRewrite() {
    for (const entry of undo) setDescription(entry.section, entry.index, entry.previous);
    setUndo([]);
    setHighlights([]);
  }

  async function runAnalysis() {
    if (!cvId) return;
    setBusy(true);
    setNotice("");
    setPrevScore(analysis ? analysis.rci_score : null);
    try {
      await flushSave();
      const result = await api<Analysis & { job_id?: string | null }>("/analyze", token, {
        method: "POST",
        body: JSON.stringify({ cv_id: cvId, jd_text: jd, ...(jobId ? { job_id: jobId } : {}) })
      });
      setAnalysis(result);
      setJobId(result.job_id ?? null);
      window.history.replaceState(null, "", `/analysis/${result.analysis_id}`);
      await refreshProfile();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể phân tích CV.");
    } finally {
      setBusy(false);
    }
  }

  async function evaluateCv() {
    setBusy(true);
    setNotice("Đang đánh giá chất lượng CV...");
    try {
      await flushSave();
      const { evaluation_id, ...result } = await api<EvaluateResult>(`/cv/${cvId}/evaluate`, token, { method: "POST", body: JSON.stringify({}) });
      const evaluation = { ...result, id: evaluation_id };
      setQuality(evaluation);
      setEvaluations((current) => [evaluation, ...current]);
      setNotice("Đã hoàn tất đánh giá CV độc lập với JD.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể đánh giá CV.");
    } finally {
      setBusy(false);
    }
  }

  async function unlockInterview() {
    if (!analysis) return;
    setBusy(true);
    setNotice("");
    try {
      const unlocked = await api<{ layer_4_mock: string[]; credits_remaining: number | null }>(
        `/analyses/${analysis.analysis_id}/unlock`, token, { method: "POST", body: JSON.stringify({}) }
      );
      setAnalysis({ ...analysis, layer_4_mock: unlocked.layer_4_mock,
        is_premium_unlocked: true, credits_remaining: unlocked.credits_remaining });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không tạo được câu hỏi phỏng vấn.");
    } finally {
      setBusy(false);
    }
  }

  async function startInterview() {
    if (!analysis) return;
    setBusy(true);
    try {
      const result = await api<{ session: { id: string } }>("/interviews", token,
        { method: "POST", body: JSON.stringify({ analysis_id: analysis.analysis_id }) });
      router.push(`/interview/${result.session.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không bắt đầu được phiên phỏng vấn.");
      setBusy(false);
    }
  }

  function exportPdf() {
    document.title = `CV-${cvData?.personal_info.name || "ung-vien"}`;
    window.print();
  }

  if (loading) return <p className="muted-copy">Đang chuẩn bị CV...</p>;
  if (!cvData) return <><p role="status" className="notice notice-info">{notice}</p><Link href="/analyze" className="text-button">← Về trang phân tích</Link></>;

  const working = busy || rewriting !== null;
  return (
    <div className="split-layout">
      <div className="split-left no-print">
        <div className="workspace-toolbar">
          <Link href="/analyze" className="text-button">← Về trang phân tích</Link>
          <div className="toolbar-actions">
            <button type="button" className="secondary-button" disabled={working} onClick={() => void evaluateCv()}>◎ Đánh giá CV</button>
            <button type="button" className="secondary-button" disabled={working || !analysis} onClick={() => void optimizeAll()}>✨ Tối ưu toàn bộ CV</button>
            <button type="button" className="primary-button" disabled={working || jd.trim().length < 50} onClick={() => void runAnalysis()}>{busy ? "Đang xử lý..." : analysis ? "↻ Phân tích lại" : "✦ Phân tích bằng AI"}</button>
          </div>
        </div>
        {notice && <p role="status" className="notice notice-info">{notice}</p>}
        {billing.panel}
        <details className="jd-details" open={!analysis}>
          <summary>Mô tả công việc (JD)</summary>
          {/* An edited JD no longer matches the posting it came from, so the link is dropped. */}
          <textarea value={jd} maxLength={20000} onChange={(event) => { setJd(event.target.value); setJobId(null); }} placeholder="Dán nội dung JD vào đây (tối thiểu 50 ký tự)..." className="jd-input" />
        </details>
        {undo.length > 0 && <p className="notice notice-info">{undo.length > 1 ? `AI vừa sửa ${undo.length} mục` : "AI vừa sửa một mục"} và đã đánh dấu trên CV. <button type="button" className="text-button" disabled={rewriting !== null} onClick={revertRewrite}>Hoàn tác</button> <button type="button" className="text-button" disabled={rewriting !== null} onClick={() => { setUndo([]); setHighlights([]); }}>Giữ thay đổi</button></p>}
        {!quality && evaluations[0] && <p className="muted-copy">CV này đã được đánh giá {evaluations.length} lần. <button type="button" className="text-button" onClick={() => setQuality(evaluations[0])}>Xem lần gần nhất ({evaluations[0].quality_score}/100)</button></p>}
        {quality && <QualityCard quality={quality} history={evaluations} onSelect={setQuality} />}
        {analysis && <AnalysisReport analysis={analysis} prevScore={prevScore} cvData={cvData} rewriting={rewriting}
          busy={busy} paying={billing.paying} paymentsEnabled={profile?.payments_enabled}
          onRewriteProject={(index, suggestion) => void rewriteOne("projects", index, suggestion)}
          onCreatePayment={() => void billing.createPayment()} onUnlock={() => void unlockInterview()}
          onStartInterview={() => void startInterview()} />}
      </div>
      <aside className="split-right">
        <div className="cv-toolbar no-print">
          <strong>CV của bạn</strong>
          <span className={`save-state save-${saveState}`}>{saveState === "saved" ? "✓ Đã lưu" : saveState === "saving" ? "Đang lưu..." : saveState === "error" ? "Lỗi lưu · sẽ thử lại" : "Chưa lưu..."}</span>
          <label className="template-select">Mẫu
            <select className="form-input" value={cvData.template} onChange={(event) => changeCv({ ...cvData, template: event.target.value as CvTemplateId })}>
              {TEMPLATE_CATEGORIES.map((group) => <optgroup key={group.id} label={group.label}>
                {CV_TEMPLATES.filter((template) => template.category === group.id).map((template) =>
                  <option key={template.id} value={template.id}>{template.name} · {template.columns} cột</option>)}
              </optgroup>)}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={exportPdf}>⬇ Xuất PDF</button>
        </div>
        <div className="cv-scroll">
          <CvPaper cv={cvData} onChange={changeCv} highlight={highlights} rewriting={rewriting} onRewrite={(section, index) => void rewriteOne(section, index)} />
        </div>
      </aside>
    </div>
  );
}
