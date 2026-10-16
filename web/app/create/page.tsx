"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../../utils/supabase/client";
import { CV_TEMPLATES, CvPaper, emptyCv, type CvData } from "../cv-editor";
import "../workspace.css";

const supabase = createClient();
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers }
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Yêu cầu chưa thể hoàn tất.");
  return payload as T;
}

const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export default function CreateCvPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [cv, setCv] = useState<CvData>(() => emptyCv());
  const [cvId, setCvId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [notice, setNotice] = useState("");
  const cvRef = useRef(cv);
  const idRef = useRef<string | null>(null);
  const savingRef = useRef<Promise<string | null> | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("cv-fit-theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
      const name = (data.session?.user.user_metadata?.full_name as string | undefined) ?? "";
      if (name) {
        const next = { ...cvRef.current, personal_info: { ...cvRef.current.personal_info, name } };
        cvRef.current = next;
        setCv(next);
      }
    });
  }, []);

  const save = useCallback(async (): Promise<string | null> => {
    if (!session) return null;
    if (savingRef.current) await savingRef.current;
    const run = (async () => {
      if (!dirtyRef.current && idRef.current) return idRef.current;
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        if (!idRef.current) {
          const created = await api<{ cv_id: string }>("/cv/create", session.access_token, { method: "POST", body: JSON.stringify({ cv_data: cvRef.current }) });
          idRef.current = created.cv_id;
          setCvId(created.cv_id);
        } else {
          await api(`/cv/${idRef.current}`, session.access_token, { method: "PUT", body: JSON.stringify({ cv_data: cvRef.current }) });
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
  }, [session]);

  function change(next: CvData) {
    cvRef.current = next;
    dirtyRef.current = true;
    setSaveState("dirty");
    setCv(next);
  }

  useEffect(() => {
    if (!dirtyRef.current || !session) return;
    const timer = window.setTimeout(() => { void save(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [cv, session, save]);

  async function analyzeThis() {
    dirtyRef.current = true;
    const id = await save();
    if (id) window.location.href = `/?cv=${id}`;
  }

  const patchItem = <K extends "education" | "experience" | "projects">(key: K, index: number, changes: Partial<CvData[K][number]>) =>
    change({ ...cv, [key]: cv[key].map((item, i) => (i === index ? { ...item, ...changes } : item)) });
  const info = cv.personal_info;
  const status = saveState === "saved" ? "✓ Đã lưu" : saveState === "saving" ? "Đang lưu..." : saveState === "error" ? "Lỗi lưu" : saveState === "dirty" ? "Chưa lưu..." : "Bản nháp mới";

  if (!ready) return <main className={`app-shell loading-shell ${theme === "dark" ? "theme-dark" : ""}`}><p>Đang tải...</p></main>;
  if (!session) {
    return (
      <main className={`app-shell loading-shell ${theme === "dark" ? "theme-dark" : ""}`}>
        <p>Bạn cần đăng nhập để tạo CV. <a href="/" className="text-button">Về trang đăng nhập</a></p>
      </main>
    );
  }

  return (
    <main className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      <header className="site-header no-print">
        <div className="header-inner">
          <a href="/" className="brand"><span className="brand-mark" aria-hidden="true">♧</span><span><strong>AI CAREER <em>READY</em></strong><small>TẠO CV TRỰC TIẾP</small></span></a>
          <div className="header-actions">
            <span className={`save-state save-${saveState}`}>{status}</span>
            <a href="/" className="text-button">← Về trang chính</a>
          </div>
        </div>
      </header>
      <div className="page-content page-wide">
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
                  <button type="button" className="text-button" onClick={() => change({ ...cv, education: cv.education.filter((_, i) => i !== index) })}>Xóa</button>
                </div>
              ))}
              <button type="button" className="secondary-button" onClick={() => change({ ...cv, education: [...cv.education, { school: "", major: "", gpa: "" }] })}>＋ Thêm học vấn</button>
            </section>

            <section className="soft-card input-card form-stack">
              <div className="section-heading"><span className="step-badge">3</span><div><h2>Kinh nghiệm</h2></div></div>
              {cv.experience.map((item, index) => (
                <div key={index} className="form-group">
                  <input className="form-input" placeholder="Vị trí" value={item.role} onChange={(e) => patchItem("experience", index, { role: e.target.value })} />
                  <input className="form-input" placeholder="Công ty" value={item.company} onChange={(e) => patchItem("experience", index, { company: e.target.value })} />
                  <textarea className="jd-input short-area" placeholder="Mô tả công việc, thành tích" value={item.description} onChange={(e) => patchItem("experience", index, { description: e.target.value })} />
                  <button type="button" className="text-button" onClick={() => change({ ...cv, experience: cv.experience.filter((_, i) => i !== index) })}>Xóa</button>
                </div>
              ))}
              <button type="button" className="secondary-button" onClick={() => change({ ...cv, experience: [...cv.experience, { company: "", role: "", description: "" }] })}>＋ Thêm kinh nghiệm</button>
            </section>

            <section className="soft-card input-card form-stack">
              <div className="section-heading"><span className="step-badge">4</span><div><h2>Dự án</h2></div></div>
              {cv.projects.map((item, index) => (
                <div key={index} className="form-group">
                  <input className="form-input" placeholder="Tên dự án" value={item.name} onChange={(e) => patchItem("projects", index, { name: e.target.value })} />
                  <input className="form-input" placeholder="Công nghệ (cách nhau bằng dấu phẩy)" defaultValue={item.technologies.join(", ")} onChange={(e) => patchItem("projects", index, { technologies: splitList(e.target.value) })} />
                  <textarea className="jd-input short-area" placeholder="Mô tả dự án, vai trò, quy mô, kết quả" value={item.description} onChange={(e) => patchItem("projects", index, { description: e.target.value })} />
                  <button type="button" className="text-button" onClick={() => change({ ...cv, projects: cv.projects.filter((_, i) => i !== index) })}>Xóa</button>
                </div>
              ))}
              <button type="button" className="secondary-button" onClick={() => change({ ...cv, projects: [...cv.projects, { name: "", technologies: [], description: "" }] })}>＋ Thêm dự án</button>
            </section>

            <section className="soft-card input-card form-stack">
              <div className="section-heading"><span className="step-badge">5</span><div><h2>Kỹ năng</h2></div></div>
              <input className="form-input" placeholder="JavaScript, SQL, Docker" defaultValue={cv.skills.join(", ")} onChange={(e) => change({ ...cv, skills: splitList(e.target.value) })} />
            </section>
          </div>

          <aside className="split-right">
            <div className="cv-toolbar no-print">
              <strong>Xem trước CV</strong>
              <div className="toolbar-actions">
                <button type="button" className="secondary-button" onClick={() => { dirtyRef.current = true; void save(); }}>💾 Lưu</button>
                <button type="button" className="secondary-button" onClick={() => { document.title = `CV-${info.name || "ung-vien"}`; window.print(); }}>⬇ Xuất PDF</button>
                <button type="button" className="primary-button" onClick={() => void analyzeThis()} disabled={saveState === "saving"}>✦ Phân tích CV này</button>
              </div>
            </div>
            <div className="cv-scroll">
              <CvPaper cv={cv} onChange={change} highlight={null} rewriting={null} />
            </div>
            {cvId && <p className="muted-copy no-print">Đã lưu vào tài khoản của bạn.</p>}
          </aside>
        </div>
      </div>
    </main>
  );
}
