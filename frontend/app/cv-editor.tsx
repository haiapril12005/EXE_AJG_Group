"use client";

import { useEffect, useRef, useState } from "react";

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
  education: { school: string; major: string; gpa: string; start_date: string; end_date: string }[];
  experience: { company: string; role: string; start_date: string; end_date: string; description: string }[];
  projects: { name: string; technologies: string[]; description: string }[];
  skills: string[];
  languages: { name: string; level: string }[];
  certificates: { name: string; issuer: string; year: string }[];
  links: { label: string; url: string }[];
};

export type RewriteSection = "summary" | "experience" | "projects";

export const EMPTY_ITEMS = {
  education: { school: "", major: "", gpa: "", start_date: "", end_date: "" },
  experience: { company: "", role: "", start_date: "", end_date: "", description: "" },
  projects: { name: "", technologies: [] as string[], description: "" },
  languages: { name: "", level: "" },
  certificates: { name: "", issuer: "", year: "" },
  links: { label: "", url: "" }
};

export type CvListKey = keyof typeof EMPTY_ITEMS;

export const emptyCv = (name = ""): CvData => ({
  template: "modern",
  personal_info: { name, email: "", phone: "", title: "" },
  summary: "",
  education: [EMPTY_ITEMS.education],
  experience: [EMPTY_ITEMS.experience],
  projects: [EMPTY_ITEMS.projects],
  skills: [],
  languages: [],
  certificates: [],
  links: []
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

/** A comma-separated list that keeps the raw text while typing and follows outside edits otherwise. */
export function ListInput({ value, onChange, placeholder }: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input className="form-input" placeholder={placeholder} value={draft ?? value.join(", ")}
    onFocus={() => setDraft(value.join(", "))}
    onBlur={() => setDraft(null)}
    onChange={(event) => { setDraft(event.target.value); onChange(splitList(event.target.value)); }} />;
}

export function CvPaper({ cv, onChange, highlight, rewriting, onRewrite }: {
  cv: CvData;
  onChange: (next: CvData) => void;
  highlight: string[];
  rewriting: string | null;
  onRewrite?: (section: RewriteSection, index: number) => void;
}) {
  const patch = (changes: Partial<CvData>) => onChange({ ...cv, ...changes });
  const patchItem = <K extends CvListKey>(key: K, index: number, changes: Partial<CvData[K][number]>) =>
    patch({ [key]: cv[key].map((item, i) => (i === index ? { ...item, ...changes } : item)) } as Partial<CvData>);
  const addItem = (key: CvListKey) => patch({ [key]: [...cv[key], EMPTY_ITEMS[key]] } as Partial<CvData>);
  const removeItem = (key: CvListKey, index: number) =>
    patch({ [key]: cv[key].filter((_, i) => i !== index) } as Partial<CvData>);
  const hl = (key: string) => (highlight.includes(key) ? "ai-highlight" : "");

  const rewriteButton = (section: RewriteSection, index: number) => onRewrite && (
    <button type="button" className="mini-ai no-print" disabled={rewriting !== null} onClick={() => onRewrite(section, index)}>
      {rewriting === `${section}-${index}` ? "Đang viết..." : "✨ AI viết lại"}
    </button>
  );
  const addButton = (key: CvListKey) => <button type="button" className="mini-add no-print" aria-label="Thêm mục" onClick={() => addItem(key)}>＋</button>;
  const removeButton = (key: CvListKey, index: number) => <button type="button" className="mini-remove no-print" aria-label="Xóa mục" onClick={() => removeItem(key, index)}>×</button>;
  const dates = (key: "education" | "experience", index: number, item: { start_date: string; end_date: string }) => (
    <span className="cv-dates">
      <Editable value={item.start_date} placeholder="Bắt đầu" onChange={(start_date) => patchItem(key, index, { start_date })} />
      <span className="cv-sep" aria-hidden="true"> – </span>
      <Editable value={item.end_date} placeholder="Kết thúc" onChange={(end_date) => patchItem(key, index, { end_date })} />
    </span>
  );

  return (
    <article className={`cv-paper cv-template-${cv.template || "modern"}`} aria-label={`Bản xem trước CV - ${cv.template || "modern"}`}>
      <header className="cv-head">
        <h1><Editable value={cv.personal_info.name} placeholder="Họ và tên" onChange={(name) => patch({ personal_info: { ...cv.personal_info, name } })} /></h1>
        <p className="cv-title"><Editable value={cv.personal_info.title} placeholder="Vị trí ứng tuyển" onChange={(title) => patch({ personal_info: { ...cv.personal_info, title } })} /></p>
        <p className="cv-contact">
          <Editable value={cv.personal_info.email} placeholder="Email" onChange={(email) => patch({ personal_info: { ...cv.personal_info, email } })} />
          <span className="cv-sep" aria-hidden="true"> · </span>
          <Editable value={cv.personal_info.phone} placeholder="Số điện thoại" onChange={(phone) => patch({ personal_info: { ...cv.personal_info, phone } })} />
        </p>
      </header>

      <section className="cv-section">
        <h2>Mục tiêu nghề nghiệp {rewriteButton("summary", 0)}</h2>
        <div className={hl("summary-0")}><Editable multiline value={cv.summary} placeholder="Mô tả ngắn về mục tiêu và thế mạnh của bạn" onChange={(summary) => patch({ summary })} /></div>
      </section>

      <section className="cv-section">
        <h2>Học vấn {addButton("education")}</h2>
        {cv.education.map((item, index) => (
          <div key={index} className="cv-item">
            {removeButton("education", index)}
            <div className="cv-row">
              <strong><Editable value={item.school} placeholder="Trường" onChange={(school) => patchItem("education", index, { school })} /></strong>
              {dates("education", index, item)}
            </div>
            <div className="cv-row">
              <Editable value={item.major} placeholder="Chuyên ngành" onChange={(major) => patchItem("education", index, { major })} />
              <span className="cv-gpa">GPA: <Editable value={item.gpa} placeholder="—" onChange={(gpa) => patchItem("education", index, { gpa })} /></span>
            </div>
          </div>
        ))}
      </section>

      <section className="cv-section">
        <h2>Kinh nghiệm {addButton("experience")}</h2>
        {cv.experience.map((item, index) => (
          <div key={index} className="cv-item">
            {removeButton("experience", index)}
            <div className="cv-row">
              <strong><Editable value={item.role} placeholder="Vị trí" onChange={(role) => patchItem("experience", index, { role })} /></strong>
              <Editable value={item.company} placeholder="Công ty" onChange={(company) => patchItem("experience", index, { company })} />
              {dates("experience", index, item)}
              {rewriteButton("experience", index)}
            </div>
            <div className={hl(`experience-${index}`)}><Editable multiline value={item.description} placeholder="Mô tả công việc và thành tích" onChange={(description) => patchItem("experience", index, { description })} /></div>
          </div>
        ))}
      </section>

      <section className="cv-section">
        <h2>Dự án {addButton("projects")}</h2>
        {cv.projects.map((item, index) => (
          <div key={index} className="cv-item">
            {removeButton("projects", index)}
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

      <section className="cv-section">
        <h2>Ngoại ngữ {addButton("languages")}</h2>
        {cv.languages.map((item, index) => (
          <div key={index} className="cv-item cv-row">
            {removeButton("languages", index)}
            <strong><Editable value={item.name} placeholder="Ngôn ngữ" onChange={(name) => patchItem("languages", index, { name })} /></strong>
            <Editable value={item.level} placeholder="Trình độ, ví dụ IELTS 7.0" onChange={(level) => patchItem("languages", index, { level })} />
          </div>
        ))}
      </section>

      <section className="cv-section">
        <h2>Chứng chỉ {addButton("certificates")}</h2>
        {cv.certificates.map((item, index) => (
          <div key={index} className="cv-item cv-row">
            {removeButton("certificates", index)}
            <strong><Editable value={item.name} placeholder="Tên chứng chỉ" onChange={(name) => patchItem("certificates", index, { name })} /></strong>
            <Editable value={item.issuer} placeholder="Đơn vị cấp" onChange={(issuer) => patchItem("certificates", index, { issuer })} />
            <Editable value={item.year} placeholder="Năm" onChange={(year) => patchItem("certificates", index, { year })} />
          </div>
        ))}
      </section>

      <section className="cv-section">
        <h2>Liên kết {addButton("links")}</h2>
        {cv.links.map((item, index) => (
          <div key={index} className="cv-item cv-row">
            {removeButton("links", index)}
            <strong><Editable value={item.label} placeholder="GitHub, LinkedIn..." onChange={(label) => patchItem("links", index, { label })} /></strong>
            <Editable value={item.url} placeholder="Đường dẫn" onChange={(url) => patchItem("links", index, { url })} />
          </div>
        ))}
      </section>
    </article>
  );
}
