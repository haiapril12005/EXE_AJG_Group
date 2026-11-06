"use client";

import type { CvData } from "./cv-editor";

export type Analysis = {
  analysis_id: string;
  rci_score: number;
  layer_1_skills: {
    matched: string[];
    missing: string[];
    evidence: { claim: string; quote: string }[];
  };
  layer_2_projects: {
    project_name: string;
    issue: string;
    suggestion: string;
    evidence: string;
  }[];
  layer_3_education: {
    major_matched: boolean;
    english_matched: boolean;
    notes: string;
    evidence: { claim: string; quote: string }[];
  };
  layer_4_mock: string[] | null;
  is_premium_unlocked: boolean;
  credits_remaining?: number | null;
  scoring_breakdown?: { category: "skills" | "experience" | "education"; weight: number; matched: number; total: number; score: number }[];
  requirements?: Requirement[];
};

export type Requirement = { category: "skills" | "experience" | "education"; jd_quote: string; cv_quote: string | null; matched: boolean };

export type QualityEvaluation = {
  id?: string;
  created_at?: string;
  quality_score: number;
  issues: { category: "content" | "presentation"; severity: string; finding: string;
    suggestion: string; evidence_quote: string | null }[];
  note?: string;
};

const dateTime = (value: string) => new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });

const SCORING_GROUPS = [
  { category: "skills", label: "Kỹ năng" },
  { category: "experience", label: "Kinh nghiệm / dự án" },
  { category: "education", label: "Học vấn" }
] as const;

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`soft-card ${className}`}>{children}</section>;
}

/** A group the JD does not mention leaves the denominator, so weights are shown as they actually counted. */
function ScoringBreakdown({ items }: { items: NonNullable<Analysis["scoring_breakdown"]> }) {
  const activeWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const skipped = SCORING_GROUPS.filter((group) => !items.some((item) => item.category === group.category));
  return (
    <div className="scoring-breakdown">
      <strong>Điểm theo quy tắc cố định</strong>
      {SCORING_GROUPS.map((group) => {
        const item = items.find((entry) => entry.category === group.category);
        return item
          ? <p key={group.category}><span>{group.label} · trọng số {Math.round(item.weight * 100 / activeWeight)}%</span><b>{item.matched}/{item.total} yêu cầu · {item.score}%</b></p>
          : <p key={group.category} className="is-skipped"><span>{group.label} · trọng số 0%</span><span>JD không nêu yêu cầu</span></p>;
      })}
      {skipped.length > 0 && <small>JD không nêu yêu cầu về {skipped.map((group) => group.label.toLowerCase()).join(", ")} nên {100 - activeWeight}% trọng số được chia theo tỉ lệ cho các nhóm còn lại. Tổng vẫn là 100%.</small>}
    </div>
  );
}

/** Each JD requirement with whether the CV proves it, so a category score can be traced line by line. */
function RequirementList({ items, emptyText }: { items: Requirement[]; emptyText: string }) {
  if (!items.length) return <p className="empty-copy">{emptyText}</p>;
  return (
    <ul className="requirement-list">
      {items.map((item, index) => (
        <li key={`${item.jd_quote}-${index}`} className={item.matched ? "is-matched" : "is-unmatched"}>
          <span aria-hidden="true">{item.matched ? "✓" : "○"}</span>
          <div>
            <strong><span className="visually-hidden">{item.matched ? "Đã đáp ứng: " : "Chưa đáp ứng: "}</span>{item.jd_quote}</strong>
            <small>{item.matched ? <>Bằng chứng từ CV: “{item.cv_quote}”</> : "Chưa thấy bằng chứng trong CV"}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** `history` is newest first; picking an entry shows that evaluation. */
export function QualityCard({ quality, history = [], onSelect }: {
  quality: QualityEvaluation;
  history?: QualityEvaluation[];
  onSelect?: (evaluation: QualityEvaluation) => void;
}) {
  const position = history.findIndex((item) => item.id === quality.id);
  const previous = position >= 0 ? history[position + 1] : undefined;
  const change = previous ? quality.quality_score - previous.quality_score : null;
  return (
    <section className="quality-section">
      <GlassCard className="input-card">
        <div className="quality-heading"><div><p className="eyebrow">ĐÁNH GIÁ CV</p><h2>Chất lượng CV</h2>
          {quality.created_at && <small className="muted-copy">Đánh giá lúc {dateTime(quality.created_at)}</small>}</div>
          <strong>{quality.quality_score}/100{change !== null && change !== 0 && <small className={`quality-change ${change > 0 ? "is-up" : "is-down"}`}>{change > 0 ? `↑ +${change}` : `↓ ${change}`} so với lần trước</small>}</strong></div>
        {history.length > 1 && onSelect && <div className="quality-history" role="group" aria-label="Các lần đánh giá CV">
          <span>Các lần đánh giá:</span>
          {history.map((item) => <button key={item.id} type="button" aria-pressed={item.id === quality.id}
            className={item.id === quality.id ? "is-current" : ""} onClick={() => onSelect(item)}>
            {item.quality_score}/100{item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString("vi-VN")}` : ""}
          </button>)}
        </div>}
        <p>{quality.note ?? "Điểm dựa trên độ đầy đủ, độ rõ ràng và cấu trúc văn bản."}</p>
        {quality.issues.length ? <ul className="quality-issues">{quality.issues.map((issue, index) =>
          <li key={index}><strong>{issue.finding}</strong><span> — {issue.suggestion}</span>
            {issue.evidence_quote && <blockquote>“{issue.evidence_quote}”</blockquote>}</li>)}</ul>
          : <p>Chưa phát hiện vấn đề rõ ràng trong nội dung CV.</p>}
      </GlassCard>
    </section>
  );
}

export function AnalysisReport({ analysis, prevScore, cvData, rewriting, busy, paying, paymentsEnabled, onRewriteProject, onCreatePayment, onUnlock, onStartInterview }: {
  analysis: Analysis;
  prevScore: number | null;
  cvData: CvData;
  rewriting: string | null;
  busy: boolean;
  paying: boolean;
  paymentsEnabled: boolean | undefined;
  onRewriteProject: (index: number, suggestion: string) => void;
  onCreatePayment: () => void;
  onUnlock: () => void;
  onStartInterview: () => void;
}) {
  // Reports saved before per-requirement scoring have no requirement list; they keep the old view.
  const requirements = analysis.requirements ?? [];
  const hasRequirements = requirements.length > 0;
  const ofCategory = (category: Requirement["category"]) => requirements.filter((item) => item.category === category);
  return (
    <section className="results-section">
      <div className="results-heading">
        <div><p className="eyebrow">BÁO CÁO PHÂN TÍCH</p><h2>Phân tích mức độ phù hợp</h2><p>Đối chiếu CV với từng yêu cầu trong JD.</p></div>
        <div className="score-summary"><span>MỨC ĐỘ BAO PHỦ</span><strong>{prevScore !== null && prevScore !== analysis.rci_score && <small className="score-prev">{prevScore}% →</small>}{analysis.rci_score}<small>%</small></strong></div>
      </div>

      {analysis.scoring_breakdown && <ScoringBreakdown items={analysis.scoring_breakdown} />}

      <div className="results-grid">
        <GlassCard className="result-card">
          <div className="section-heading"><span className="layer-icon layer-skills">✣</span><h3>Kỹ năng</h3></div>
          <div className="result-inset">
            <p className="result-label positive-label">ĐÃ CÓ TRONG CV</p>
            <div className="pill-list">{analysis.layer_1_skills.matched.length ? analysis.layer_1_skills.matched.map((item) => <span key={item} className="pill pill-green">✓ {item}</span>) : <span className="empty-copy">Chưa thấy kỹ năng trùng khớp.</span>}</div>
          </div>
          {analysis.layer_1_skills.evidence.length > 0 && <div className="evidence-list">{analysis.layer_1_skills.evidence.map((item, index) => <blockquote key={`${item.claim}-${index}`} className="evidence-quote"><strong>{item.claim}:</strong> “{item.quote}”</blockquote>)}</div>}
          <div className="result-inset missing-inset">
            <p className="result-label missing-label">CÒN THIẾU · CẦN BỔ SUNG</p>
            <div className="pill-list">{analysis.layer_1_skills.missing.length ? analysis.layer_1_skills.missing.map((item) => <span key={item} className="pill pill-amber">＋ {item}</span>) : <span className="empty-copy">Không có kỹ năng nổi bật bị thiếu.</span>}</div>
          </div>
        </GlassCard>

        <GlassCard className="result-card">
          <div className="section-heading"><span className="layer-icon layer-projects">▣</span><h3>Kinh nghiệm & dự án</h3></div>
          {hasRequirements && <div className="result-inset">
            <p className="result-label">YÊU CẦU KINH NGHIỆM TRONG JD</p>
            <RequirementList items={ofCategory("experience")} emptyText="JD không nêu yêu cầu kinh nghiệm cụ thể, nên phần này không tính vào điểm." />
          </div>}
          {hasRequirements && <p className="result-label project-feedback-label">NHẬN XÉT DỰ ÁN TRONG CV</p>}
          {analysis.layer_2_projects.length ? <div className="project-list">
            {analysis.layer_2_projects.map((project, index) => {
              const target = cvData.projects.findIndex((item) => {
                const a = item.name.trim().toLowerCase();
                const b = project.project_name.trim().toLowerCase();
                return a !== "" && (a.includes(b) || b.includes(a));
              });
              return (
                <article key={`${project.project_name}-${index}`} className="project-item">
                  <strong>{project.project_name}</strong>
                  <p><b>Điểm cần bổ sung:</b> {project.issue}</p>
                  <p><b>Gợi ý:</b> {project.suggestion}</p>
                  <blockquote className="evidence-quote">Bằng chứng từ CV: “{project.evidence}”</blockquote>
                  {target >= 0 && <button type="button" className="mini-ai" disabled={rewriting !== null} onClick={() => onRewriteProject(target, `${project.issue}. ${project.suggestion}`)}>{rewriting === `projects-${target}` ? "Đang viết..." : "✨ AI viết lại mục này"}</button>}
                </article>
              );
            })}
          </div> : <p className="empty-copy">AI chưa tìm thấy dự án cụ thể trong CV để nhận xét.</p>}
        </GlassCard>

        <GlassCard className="result-card">
          <div className="section-heading"><span className="layer-icon layer-education">◇</span><h3>Học vấn & bằng cấp</h3></div>
          {hasRequirements ? <div className="result-inset">
            <p className="result-label">YÊU CẦU HỌC VẤN, NGOẠI NGỮ, CHỨNG CHỈ TRONG JD</p>
            <RequirementList items={ofCategory("education")} emptyText="JD không nêu yêu cầu về học vấn, ngoại ngữ hay chứng chỉ, nên phần này không tính vào điểm." />
          </div> : <div className="education-grid">
            <div className={`education-item ${analysis.layer_3_education.major_matched ? "is-matched" : "is-unmatched"}`}>
              <span>{analysis.layer_3_education.major_matched ? "✓" : "○"}</span><strong>Chuyên ngành</strong><small>{analysis.layer_3_education.major_matched ? "Phù hợp yêu cầu JD" : "Chưa có bằng chứng phù hợp"}</small>
            </div>
            <div className={`education-item ${analysis.layer_3_education.english_matched ? "is-matched" : "is-unmatched"}`}>
              <span>{analysis.layer_3_education.english_matched ? "✓" : "○"}</span><strong>Ngoại ngữ</strong><small>{analysis.layer_3_education.english_matched ? "Đáp ứng yêu cầu tiếng Anh" : "Chưa có bằng chứng phù hợp"}</small>
            </div>
          </div>}
          <p className="education-notes">{analysis.layer_3_education.notes}</p>
          {analysis.layer_3_education.evidence.map((item, index) => <blockquote key={`${item.claim}-${index}`} className="evidence-quote"><strong>{item.claim}:</strong> “{item.quote}”</blockquote>)}
        </GlassCard>

        <GlassCard className="result-card interview-card">
          <div className="interview-title">
            <div className="section-heading"><span className="layer-icon layer-interview">☏</span><h3>Luyện phỏng vấn</h3></div>
            {!analysis.layer_4_mock && paymentsEnabled && <span className="premium-badge">PREMIUM</span>}
          </div>
          {analysis.layer_4_mock ? (
            <><ol className="question-list">{analysis.layer_4_mock.map((question, index) => <li key={`${index}-${question}`}><span>{String(index + 1).padStart(2, "0")}</span>{question}</li>)}</ol>
              <button type="button" className="primary-button" disabled={busy} onClick={onStartInterview}>🎙 Bắt đầu luyện trả lời</button></>
          ) : (
            <>
              <p className="interview-copy">Tạo 3 câu hỏi phỏng vấn mô phỏng theo kỹ năng và dự án trong CV.</p>
              {paymentsEnabled
                ? <button disabled={busy || paying} onClick={onCreatePayment} className="unlock-button">♙ &nbsp; Mở khóa phiên phỏng vấn · 29.000đ</button>
                : paymentsEnabled === false
                  ? <button disabled={busy} onClick={onUnlock} className="primary-button">Tạo câu hỏi và luyện miễn phí</button>
                  : null}
            </>
          )}
        </GlassCard>
      </div>
      <p className="results-disclaimer">♧ &nbsp; Dữ liệu liên hệ được ẩn danh. Điểm số không phản ánh xác suất trúng tuyển.</p>
    </section>
  );
}
