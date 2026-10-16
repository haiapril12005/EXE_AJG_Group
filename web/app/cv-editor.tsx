"use client";

import { useEffect, useRef } from "react";

export const CV_TEMPLATES = [
  { id: "modern", name: "Modern", description: "Xanh ngọc, cân bằng, phù hợp đa ngành." },
  { id: "classic", name: "Classic", description: "Trang trọng, serif, hợp tài chính và quản lý." },
  { id: "minimal", name: "Minimal", description: "Tối giản, đơn sắc, tập trung vào nội dung." },
  { id: "creative", name: "Creative", description: "Bố cục nổi bật, thanh bên màu tím." },
  { id: "executive", name: "Executive", description: "Xanh navy chuyên nghiệp cho vị trí senior." },
  { id: "compact", name: "Compact", description: "Gọn gàng, tận dụng trang cho hồ sơ nhiều mục." }
] as const;

export type CvTemplateId = (typeof CV_TEMPLATES)[number]["id"];

export type CvData = {
  template: CvTemplateId;
  personal_info: { name: string; email: string; phone: string; title: string };
  summary: string;
  education: { school: string; major: string; gpa: string }[];
  experience: { company: string; role: string; description: string }[];
  projects: { name: string; technologies: string[]; description: string }[];
  skills: string[];
};

export type RewriteSection = "summary" | "experience" | "projects";

export const emptyCv = (name = ""): CvData => ({
  template: "modern",
  personal_info: { name, email: "", phone: "", title: "" },
  summary: "",
  education: [{ school: "", major: "", gpa: "" }],
  experience: [{ company: "", role: "", description: "" }],
  projects: [{ name: "", technologies: [], description: "" }],
  skills: []
});

function Editable({ value, onChange, placeholder, multiline = false, className = "" }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element && document.activeElement !== element && element.innerText !== value) {
      element.textContent = value;
    }
  }, [value]);
  return (
    <span
      ref={ref}
      className={`editable ${multiline ? "editable-block" : ""} ${className}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      onInput={(event) => onChange(event.currentTarget.innerText)}
      onKeyDown={(event) => { if (!multiline && event.key === "Enter") event.preventDefault(); }}
    />
  );
}

const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function CvPaper({ cv, onChange, highlight, rewriting, onRewrite }: {
  cv: CvData;
  onChange: (next: CvData) => void;
  highlight: string | null;
  rewriting: string | null;
  onRewrite?: (section: RewriteSection, index: number) => void;
}) {
  const patch = (changes: Partial<CvData>) => onChange({ ...cv, ...changes });
  const patchItem = <K extends "education" | "experience" | "projects">(key: K, index: number, changes: Partial<CvData[K][number]>) =>
    patch({ [key]: cv[key].map((item, i) => (i === index ? { ...item, ...changes } : item)) } as Partial<CvData>);
  const removeItem = (key: "education" | "experience" | "projects", index: number) =>
    patch({ [key]: cv[key].filter((_, i) => i !== index) } as Partial<CvData>);
  const hl = (key: string) => (highlight === key ? "ai-highlight" : "");

  const rewriteButton = (section: RewriteSection, index: number) => onRewrite && (
    <button type="button" className="mini-ai no-print" disabled={rewriting !== null} onClick={() => onRewrite(section, index)}>
      {rewriting === `${section}-${index}` ? "Đang viết..." : "✨ AI viết lại"}
    </button>
  );

  return (
    <article className={`cv-paper cv-template-${cv.template || "modern"}`} aria-label={`Bản xem trước CV - ${cv.template || "modern"}`}>
      <header className="cv-head">
        <h1><Editable value={cv.personal_info.name} placeholder="Họ và tên" onChange={(name) => patch({ personal_info: { ...cv.personal_info, name } })} /></h1>
        <p className="cv-title"><Editable value={cv.personal_info.title} placeholder="Vị trí ứng tuyển" onChange={(title) => patch({ personal_info: { ...cv.personal_info, title } })} /></p>
        <p className="cv-contact">
          <Editable value={cv.personal_info.email} placeholder="Email" onChange={(email) => patch({ personal_info: { ...cv.personal_info, email } })} />
          <span aria-hidden="true"> · </span>
          <Editable value={cv.personal_info.phone} placeholder="Số điện thoại" onChange={(phone) => patch({ personal_info: { ...cv.personal_info, phone } })} />
        </p>
      </header>

      <section className="cv-section">
        <h2>Mục tiêu nghề nghiệp {rewriteButton("summary", 0)}</h2>
        <div className={hl("summary-0")}><Editable multiline value={cv.summary} placeholder="Mô tả ngắn về mục tiêu và thế mạnh của bạn" onChange={(summary) => patch({ summary })} /></div>
      </section>

      <section className="cv-section">
        <h2>Học vấn <button type="button" className="mini-add no-print" onClick={() => patch({ education: [...cv.education, { school: "", major: "", gpa: "" }] })}>＋</button></h2>
        {cv.education.map((item, index) => (
          <div key={index} className="cv-item">
            <button type="button" className="mini-remove no-print" aria-label="Xóa mục" onClick={() => removeItem("education", index)}>×</button>
            <strong><Editable value={item.school} placeholder="Trường" onChange={(school) => patchItem("education", index, { school })} /></strong>
            <div className="cv-row">
              <Editable value={item.major} placeholder="Chuyên ngành" onChange={(major) => patchItem("education", index, { major })} />
              <span>GPA: <Editable value={item.gpa} placeholder="—" onChange={(gpa) => patchItem("education", index, { gpa })} /></span>
            </div>
          </div>
        ))}
      </section>

      <section className="cv-section">
        <h2>Kinh nghiệm <button type="button" className="mini-add no-print" onClick={() => patch({ experience: [...cv.experience, { company: "", role: "", description: "" }] })}>＋</button></h2>
        {cv.experience.map((item, index) => (
          <div key={index} className="cv-item">
            <button type="button" className="mini-remove no-print" aria-label="Xóa mục" onClick={() => removeItem("experience", index)}>×</button>
            <div className="cv-row">
              <strong><Editable value={item.role} placeholder="Vị trí" onChange={(role) => patchItem("experience", index, { role })} /></strong>
              <Editable value={item.company} placeholder="Công ty" onChange={(company) => patchItem("experience", index, { company })} />
              {rewriteButton("experience", index)}
            </div>
            <div className={hl(`experience-${index}`)}><Editable multiline value={item.description} placeholder="Mô tả công việc và thành tích" onChange={(description) => patchItem("experience", index, { description })} /></div>
          </div>
        ))}
      </section>

      <section className="cv-section">
        <h2>Dự án <button type="button" className="mini-add no-print" onClick={() => patch({ projects: [...cv.projects, { name: "", technologies: [], description: "" }] })}>＋</button></h2>
        {cv.projects.map((item, index) => (
          <div key={index} className="cv-item">
            <button type="button" className="mini-remove no-print" aria-label="Xóa mục" onClick={() => removeItem("projects", index)}>×</button>
            <div className="cv-row">
              <strong><Editable value={item.name} placeholder="Tên dự án" onChange={(name) => patchItem("projects", index, { name })} /></strong>
              {rewriteButton("projects", index)}
            </div>
            <p className="cv-tech">Công nghệ: <Editable value={item.technologies.join(", ")} placeholder="Node.js, React" onChange={(value) => patchItem("projects", index, { technologies: splitList(value) })} /></p>
            <div className={hl(`projects-${index}`)}><Editable multiline value={item.description} placeholder="Mô tả dự án, vai trò, quy mô và kết quả" onChange={(description) => patchItem("projects", index, { description })} /></div>
          </div>
        ))}
      </section>

      <section className="cv-section">
        <h2>Kỹ năng</h2>
        <Editable value={cv.skills.join(", ")} placeholder="JavaScript, SQL, Docker" onChange={(value) => patch({ skills: splitList(value) })} />
      </section>
    </article>
  );
}
