"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../utils/api";
import { useApp } from "../app-frame";
import { CV_TEMPLATES, CvPaper, EMPTY_ITEMS, emptyCv, ListInput, type CvData, type CvListKey } from "../cv-editor";

export default function CreateCvPage() {
  const { session, token } = useApp();
  const router = useRouter();
  const [cv, setCv] = useState<CvData>(() => emptyCv((session.user.user_metadata?.full_name as string | undefined) ?? ""));
  const [cvId, setCvId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [notice, setNotice] = useState("");
  const cvRef = useRef(cv);
  const idRef = useRef<string | null>(null);
  const savingRef = useRef<Promise<string | null> | null>(null);
  const dirtyRef = useRef(false);

  const save = useCallback(async (): Promise<string | null> => {
    if (savingRef.current) await savingRef.current;
    const run = (async () => {
      if (!dirtyRef.current && idRef.current) return idRef.current;
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        if (!idRef.current) {
          const created = await api<{ cv_id: string }>("/cv/create", token, { method: "POST", body: JSON.stringify({ cv_data: cvRef.current }) });
          idRef.current = created.cv_id;
          setCvId(created.cv_id);
        } else {
          await api(`/cv/${idRef.current}`, token, { method: "PUT", body: JSON.stringify({ cv_data: cvRef.current }) });
        }
        setSaveState(dirtyRef.current ? "dirty" : "saved");
        return idRef.current;
      } catch (error) {
        dirtyRef.current = true;
        setSaveState("error");
        setNotice(error instanceof Error ? error.message : "Không thể lưu CV.");
        return null;
      }
    })();
    savingRef.current = run;
    try { return await run; } finally { savingRef.current = null; }
  }, [token]);

  function change(next: CvData) {
    cvRef.current = next;
    dirtyRef.current = true;
    setSaveState("dirty");
    setCv(next);
  }

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => { void save(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [cv, save]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => () => {
    // Leaving the page cancels the autosave timer, so save what is still pending.
    if (dirtyRef.current) void saveRef.current();
  }, []);

  async function analyzeThis() {
    dirtyRef.current = true;
    const id = await save();
    if (id) router.push(`/cv/${id}`);
  }

  const patchItem = <K extends CvListKey>(key: K, index: number, changes: Partial<CvData[K][number]>) =>
    change({ ...cv, [key]: cv[key].map((item, i) => (i === index ? { ...item, ...changes } : item)) });
  const addItem = (key: CvListKey) => change({ ...cv, [key]: [...cv[key], EMPTY_ITEMS[key]] });
  const removeItem = (key: CvListKey, index: number) => change({ ...cv, [key]: cv[key].filter((_, i) => i !== index) });
  const info = cv.personal_info;
  const status = saveState === "saved" ? "✓ Đã lưu" : saveState === "saving" ? "Đang lưu..." : saveState === "error" ? "Lỗi lưu" : saveState === "dirty" ? "Chưa lưu..." : "Bản nháp mới";

  return (
    <>
      {notice && <p role="status" className="notice notice-info no-print">{notice}</p>}
      <section className="template-picker no-print" aria-label="Chọn mẫu CV">
        <div className="template-picker-heading"><div><p className="eyebrow">THƯ VIỆN THIẾT KẾ</p><h1>Chọn mẫu CV của bạn</h1><p>Chọn một phong cách. Nội dung đã nhập sẽ được giữ nguyên.</p></div><span className="template-count">{CV_TEMPLATES.length} mẫu</span></div>
        <div className="template-grid">
          {CV_TEMPLATES.map((template) => (
            <button key={template.id} type="button" className={`template-card ${cv.template === template.id ? "is-selected" : ""}`} aria-pressed={cv.template === template.id} onClick={() => change({ ...cv, template: template.id })}>
              <span className={`template-thumb template-thumb-${template.id}`} aria-hidden="true"><i /><b /><em /><small /><small /><small /><small /></span>
              <span className="template-card-copy"><strong>{template.name}</strong><small>{template.description}</small></span>
              {cv.template === template.id && <span className="template-selected-mark" aria-label="Đang chọn">✓</span>}
            </button>
          ))}
        </div>
      </section>
      <div className="split-layout create-layout">
        <div className="split-left no-print">
          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">1</span><div><h2>Thông tin cá nhân</h2><p>Điền form, CV bên phải cập nhật ngay.</p></div></div>
            <label className="field-label">Họ và tên<input className="form-input" value={info.name} onChange={(e) => change({ ...cv, personal_info: { ...info, name: e.target.value } })} /></label>
            <label className="field-label">Vị trí ứng tuyển<input className="form-input" value={info.title} onChange={(e) => change({ ...cv, personal_info: { ...info, title: e.target.value } })} /></label>
            <label className="field-label">Email<input className="form-input" type="email" value={info.email} onChange={(e) => change({ ...cv, personal_info: { ...info, email: e.target.value } })} /></label>
            <label className="field-label">Số điện thoại<input className="form-input" value={info.phone} onChange={(e) => change({ ...cv, personal_info: { ...info, phone: e.target.value } })} /></label>
            <label className="field-label">Mục tiêu nghề nghiệp<textarea className="jd-input short-area" value={cv.summary} maxLength={3000} onChange={(e) => change({ ...cv, summary: e.target.value })} /></label>
          </section>

          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">2</span><div><h2>Học vấn</h2></div></div>
            {cv.education.map((item, index) => (
              <div key={index} className="form-group">
                <input className="form-input" placeholder="Trường" value={item.school} onChange={(e) => patchItem("education", index, { school: e.target.value })} />
                <input className="form-input" placeholder="Chuyên ngành" value={item.major} onChange={(e) => patchItem("education", index, { major: e.target.value })} />
                <input className="form-input" placeholder="GPA" value={item.gpa} onChange={(e) => patchItem("education", index, { gpa: e.target.value })} />
                <div className="form-row">
                  <input className="form-input" placeholder="Bắt đầu, ví dụ 09/2022" value={item.start_date} onChange={(e) => patchItem("education", index, { start_date: e.target.value })} />
                  <input className="form-input" placeholder="Kết thúc, ví dụ 06/2026" value={item.end_date} onChange={(e) => patchItem("education", index, { end_date: e.target.value })} />
                </div>
                <button type="button" className="text-button" onClick={() => removeItem("education", index)}>Xóa</button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => addItem("education")}>＋ Thêm học vấn</button>
          </section>

          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">3</span><div><h2>Kinh nghiệm</h2></div></div>
            {cv.experience.map((item, index) => (
              <div key={index} className="form-group">
                <input className="form-input" placeholder="Vị trí" value={item.role} onChange={(e) => patchItem("experience", index, { role: e.target.value })} />
                <input className="form-input" placeholder="Công ty" value={item.company} onChange={(e) => patchItem("experience", index, { company: e.target.value })} />
                <div className="form-row">
                  <input className="form-input" placeholder="Bắt đầu, ví dụ 01/2025" value={item.start_date} onChange={(e) => patchItem("experience", index, { start_date: e.target.value })} />
                  <input className="form-input" placeholder="Kết thúc, ví dụ Hiện tại" value={item.end_date} onChange={(e) => patchItem("experience", index, { end_date: e.target.value })} />
                </div>
                <textarea className="jd-input short-area" placeholder="Mô tả công việc, thành tích" value={item.description} onChange={(e) => patchItem("experience", index, { description: e.target.value })} />
                <button type="button" className="text-button" onClick={() => removeItem("experience", index)}>Xóa</button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => addItem("experience")}>＋ Thêm kinh nghiệm</button>
          </section>

          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">4</span><div><h2>Dự án</h2></div></div>
            {cv.projects.map((item, index) => (
              <div key={index} className="form-group">
                <input className="form-input" placeholder="Tên dự án" value={item.name} onChange={(e) => patchItem("projects", index, { name: e.target.value })} />
                <ListInput placeholder="Công nghệ (cách nhau bằng dấu phẩy)" value={item.technologies} onChange={(technologies) => patchItem("projects", index, { technologies })} />
                <textarea className="jd-input short-area" placeholder="Mô tả dự án, vai trò, quy mô, kết quả" value={item.description} onChange={(e) => patchItem("projects", index, { description: e.target.value })} />
                <button type="button" className="text-button" onClick={() => removeItem("projects", index)}>Xóa</button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => addItem("projects")}>＋ Thêm dự án</button>
          </section>

          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">5</span><div><h2>Kỹ năng</h2></div></div>
            <ListInput placeholder="JavaScript, SQL, Docker" value={cv.skills} onChange={(skills) => change({ ...cv, skills })} />
          </section>

          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">6</span><div><h2>Ngoại ngữ</h2></div></div>
            {cv.languages.map((item, index) => (
              <div key={index} className="form-group">
                <div className="form-row">
                  <input className="form-input" placeholder="Ngôn ngữ" value={item.name} onChange={(e) => patchItem("languages", index, { name: e.target.value })} />
                  <input className="form-input" placeholder="Trình độ, ví dụ IELTS 7.0" value={item.level} onChange={(e) => patchItem("languages", index, { level: e.target.value })} />
                </div>
                <button type="button" className="text-button" onClick={() => removeItem("languages", index)}>Xóa</button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => addItem("languages")}>＋ Thêm ngoại ngữ</button>
          </section>

          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">7</span><div><h2>Chứng chỉ</h2></div></div>
            {cv.certificates.map((item, index) => (
              <div key={index} className="form-group">
                <input className="form-input" placeholder="Tên chứng chỉ" value={item.name} onChange={(e) => patchItem("certificates", index, { name: e.target.value })} />
                <div className="form-row">
                  <input className="form-input" placeholder="Đơn vị cấp" value={item.issuer} onChange={(e) => patchItem("certificates", index, { issuer: e.target.value })} />
                  <input className="form-input" placeholder="Năm" value={item.year} onChange={(e) => patchItem("certificates", index, { year: e.target.value })} />
                </div>
                <button type="button" className="text-button" onClick={() => removeItem("certificates", index)}>Xóa</button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => addItem("certificates")}>＋ Thêm chứng chỉ</button>
          </section>

          <section className="soft-card input-card form-stack">
            <div className="section-heading"><span className="step-badge">8</span><div><h2>Liên kết</h2></div></div>
            {cv.links.map((item, index) => (
              <div key={index} className="form-group">
                <div className="form-row">
                  <input className="form-input" placeholder="GitHub, LinkedIn..." value={item.label} onChange={(e) => patchItem("links", index, { label: e.target.value })} />
                  <input className="form-input" placeholder="Đường dẫn" value={item.url} onChange={(e) => patchItem("links", index, { url: e.target.value })} />
                </div>
                <button type="button" className="text-button" onClick={() => removeItem("links", index)}>Xóa</button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={() => addItem("links")}>＋ Thêm liên kết</button>
          </section>
        </div>

        <aside className="split-right">
          <div className="cv-toolbar no-print">
            <strong>Xem trước CV</strong>
            <span className={`save-state save-${saveState}`}>{status}</span>
            <div className="toolbar-actions">
              <button type="button" className="secondary-button" onClick={() => { dirtyRef.current = true; void save(); }}>💾 Lưu</button>
              <button type="button" className="secondary-button" onClick={() => { document.title = `CV-${info.name || "ung-vien"}`; window.print(); }}>⬇ Xuất PDF</button>
              <button type="button" className="primary-button" onClick={() => void analyzeThis()} disabled={saveState === "saving"}>✦ Phân tích CV này</button>
            </div>
          </div>
          <div className="cv-scroll">
            <CvPaper cv={cv} onChange={change} highlight={[]} rewriting={null} />
          </div>
          {cvId && <p className="muted-copy no-print">Đã lưu vào tài khoản của bạn.</p>}
        </aside>
      </div>
    </>
  );
}
