"use client";

import QRCode from "qrcode";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../utils/supabase/client";
import { CvPaper, emptyCv, type CvData, type RewriteSection } from "./cv-editor";
import "./workspace.css";

const supabase = createClient();

type Profile = {
  id: string;
  email: string;
  full_name: string;
  credits: number;
};

type Analysis = {
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
  credits_remaining: number;
};

const ANALYSIS_STEPS = [
  "Đang phân tích kỹ năng...",
  "Đang bóc tách dự án...",
  "Đang đối chiếu học vấn...",
  "Đang kiểm chứng bằng chứng từ CV...",
  "Sắp xong, đang hoàn thiện báo cáo..."
];

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Yêu cầu chưa thể hoàn tất.");
  return payload as T;
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`soft-card ${className}`}>{children}</section>;
}

function AuthScreen({ onSession, theme, onToggleTheme }: {
  onSession: (session: Session) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (register) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        });
        if (error) throw error;
        if (!data.session) {
          setMessage("Vui lòng kiểm tra email để xác nhận tài khoản.");
        } else {
          onSession(data.session);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSession(data.session);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Đã xảy ra lỗi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      <div className="auth-topbar">
        <Brand />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="auth-wrap">
        <GlassCard className="auth-card">
          <div className="auth-mark" aria-hidden="true">✦</div>
          <p className="eyebrow">AI CAREER READY</p>
          <h1>{register ? "Tạo tài khoản" : "Chào mừng trở lại"}</h1>
          <p className="muted-copy">Đối chiếu CV với công việc mơ ước và chuẩn bị phỏng vấn tự tin hơn.</p>
          <form className="form-stack" onSubmit={submit}>
            {register && <label className="field-label">Họ và tên<input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="form-input" autoComplete="name" /></label>}
            <label className="field-label">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="form-input" autoComplete="email" /></label>
            <label className="field-label">Mật khẩu<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="form-input" autoComplete={register ? "new-password" : "current-password"} /></label>
            {message && <p role="status" className="notice notice-info">{message}</p>}
            <button disabled={busy} className="primary-button">{busy ? "Đang xử lý..." : register ? "Tạo tài khoản miễn phí" : "Đăng nhập"}</button>
          </form>
          <p className="auth-switch">
            {register ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
            <button onClick={() => { setRegister(!register); setMessage(""); }}>
              {register ? "Đăng nhập" : "Đăng ký"}
            </button>
          </p>
        </GlassCard>
      </div>
    </main>
  );
}

function Brand() {
  return (
    <a href="#" className="brand">
      <span className="brand-mark" aria-hidden="true">♧</span>
      <span><strong>AI CAREER <em>READY</em></strong><small>DỰ ÁN EXE101 · NHÓM 81</small></span>
    </a>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button className="theme-toggle" type="button" onClick={onToggle} aria-label={theme === "light" ? "Bật giao diện tối" : "Bật giao diện sáng"}>
      <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
    </button>
  );
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cvId, setCvId] = useState("");
  const [jd, setJd] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [payment, setPayment] = useState<{ order_code: number; checkoutUrl: string; qrImage: string | null } | null>(null);
  const [paymentStatus, setPaymentStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [cvData, setCvData] = useState<CvData | null>(null);
  const cvRef = useRef<CvData | null>(null);
  const dirtyRef = useRef(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [editorOpen, setEditorOpen] = useState(false);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ key: string; section: RewriteSection; index: number; previous: string } | null>(null);
  const [prevScore, setPrevScore] = useState<number | null>(null);
  const [loadingCv, setLoadingCv] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  useEffect(() => {
    if (!busy) { setStepIndex(0); return; }
    const timer = window.setInterval(() => setStepIndex((value) => value + 1), 2500);
    return () => window.clearInterval(timer);
  }, [busy]);
  const initialCvLoaded = useRef(false);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(`Không thể đăng xuất: ${error.message}`);
  }

  const refreshProfile = useCallback(async (token: string) => {
    const result = await api<{ user: Profile }>("/user/me", token);
    setProfile(result.user);
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("cv-fit-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("cv-fit-theme", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setNotice(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) void refreshProfile(session.access_token).catch((error: Error) => {
      setNotice(error.message);
    });
  }, [session, refreshProfile]);

  useEffect(() => {
    if (!session || !payment) return;
    let active = true;
    let unlocking = false;
    const poll = async () => {
      try {
        const result = await api<{ transaction: { status: string } }>(
          `/payment/${payment.order_code}`,
          session.access_token
        );
        if (!active) return;
        if (result.transaction.status === "SUCCESS") {
          setPaymentStatus("Thanh toán thành công! Đang mở khóa Mock Interview...");
          if (!analysis || analysis.layer_4_mock || unlocking) {
            if (analysis?.layer_4_mock) {
              setPayment(null);
              await refreshProfile(session.access_token);
            }
            return;
          }
          unlocking = true;
          try {
            const unlocked = await api<{ layer_4_mock: string[]; credits_remaining: number }>(
              `/analyses/${analysis.analysis_id}/unlock`,
              session.access_token,
              { method: "POST", body: JSON.stringify({}) }
            );
            if (!active) return;
            setAnalysis({ ...analysis, layer_4_mock: unlocked.layer_4_mock, is_premium_unlocked: true, credits_remaining: unlocked.credits_remaining });
            setPaymentStatus("Mock Interview đã được mở khóa.");
            setPayment(null);
            await refreshProfile(session.access_token);
          } catch (error) {
            setPaymentStatus(error instanceof Error ? error.message : "Không thể mở khóa Mock Interview.");
            setPayment(null);
            await refreshProfile(session.access_token);
          }
        } else if (result.transaction.status === "CANCELLED") {
          setPaymentStatus("Giao dịch đã bị hủy.");
          setPayment(null);
        }
      } catch {
        if (active) setPaymentStatus("Đang chờ xác nhận thanh toán...");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session, payment, analysis, refreshProfile]);

  async function uploadCV(event: FormEvent) {
    event.preventDefault();
    if (!session || !selectedFile) return;
    setBusy(true);
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const result = await api<{ cv_id: string; cv_data?: CvData }>("/cv/upload", session.access_token, { method: "POST", body: form });
      dirtyRef.current = false;
      setCvId(result.cv_id);
      setCvData(result.cv_data ?? null);
      setSaveState("saved");
      setAnalysis(null);
      setEditorOpen(false);
      setNotice("CV đã được tải lên an toàn. Số điện thoại và email được che trước khi gửi AI.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tải CV.");
    } finally {
      setBusy(false);
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
      dirtyRef.current = false;
      setCvId("");
      setCvData(null);
      setEditorOpen(false);
      setAnalysis(null);
    }
  }

  async function flushSave(): Promise<void> {
    if (!session || !cvId || !dirtyRef.current || !cvRef.current) return;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      await api("/cv/" + cvId, session.access_token, { method: "PUT", body: JSON.stringify({ cv_data: cvRef.current }) });
      setSaveState(dirtyRef.current ? "dirty" : "saved");
    } catch (error) {
      dirtyRef.current = true;
      setSaveState("error");
      throw error;
    }
  }

  function changeCv(next: CvData) {
    dirtyRef.current = true;
    setSaveState("dirty");
    setCvData(next);
  }

  useEffect(() => {
    cvRef.current = cvData;
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => { void flushSave().catch(() => undefined); }, 1200);
    return () => window.clearTimeout(timer);
    // flushSave reads the latest values through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvData, cvId, session]);

  async function loadCv(id: string, token: string, open: boolean): Promise<void> {
    setLoadingCv(true);
    try {
      const result = await api<{ cv_data: CvData }>(`/cv/${id}`, token);
      dirtyRef.current = false;
      setCvData(result.cv_data);
      setSaveState("saved");
      if (open) setEditorOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể mở CV.");
    } finally {
      setLoadingCv(false);
    }
  }

  useEffect(() => {
    if (!session || initialCvLoaded.current) return;
    const id = new URLSearchParams(window.location.search).get("cv");
    initialCvLoaded.current = true;
    if (!id) return;
    setCvId(id);
    window.history.replaceState(null, "", "/");
    void loadCv(id, session.access_token, true);
    // runs once when the session becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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
    const missing = analysis?.layer_1_skills.missing ?? [];
    const fallback = missing.length
      ? `Làm nổi bật các yêu cầu của JD mà mục này có thể chứng minh bằng thông tin sẵn có (JD đang thiếu: ${missing.join(", ")}). Không thêm công nghệ chưa có.`
      : "Làm nổi bật các điểm phù hợp nhất với JD bằng thông tin sẵn có.";
    if (section !== "projects" || !analysis || !cvRef.current) return fallback;
    const name = cvRef.current.projects[index]?.name.trim().toLowerCase();
    const match = name ? analysis.layer_2_projects.find((item) => {
      const candidate = item.project_name.trim().toLowerCase();
      return candidate.includes(name) || name.includes(candidate);
    }) : undefined;
    return match ? `${match.issue}. ${match.suggestion}` : fallback;
  }

  async function rewriteOne(section: RewriteSection, index: number, suggestion?: string) {
    if (!session || !cvRef.current) return;
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
      const result = await api<{ new_description: string }>("/ai/rewrite-section", session.access_token, {
        method: "POST",
        body: JSON.stringify({
          jd_text: jd,
          section_type: section,
          current_section_data: current,
          ai_suggestion: suggestion ?? suggestionFor(section, index)
        })
      });
      setUndo({ key, section, index, previous: current.description });
      setHighlight(key);
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
    for (const [section, index] of targets) await rewriteOne(section, index);
  }

  function revertRewrite() {
    if (!undo) return;
    setDescription(undo.section, undo.index, undo.previous);
    setUndo(null);
    setHighlight(null);
  }

  async function reanalyze() {
    try {
      await flushSave();
    } catch {
      setNotice("Không thể lưu CV trước khi phân tích lại.");
      return;
    }
    await runAnalysis();
  }

  function exportPdf() {
    document.title = `CV-${cvData?.personal_info.name || "ung-vien"}`;
    window.print();
  }

  async function runAnalysis() {
    if (!session || !cvId) return;
    setBusy(true);
    setNotice("");
    setPaymentStatus("");
    setPrevScore(analysis ? analysis.rci_score : null);
    try {
      const result = await api<Analysis>("/analyze", session.access_token, {
        method: "POST",
        body: JSON.stringify({ cv_id: cvId, jd_text: jd })
      });
      setAnalysis(result);
      await refreshProfile(session.access_token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể phân tích CV.");
    } finally {
      setBusy(false);
    }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    try {
      await flushSave();
    } catch {
      setNotice("Không thể lưu CV trước khi phân tích.");
      return;
    }
    await Promise.all([
      runAnalysis(),
      !cvRef.current && session ? loadCv(cvId, session.access_token, false) : Promise.resolve()
    ]);
  }

  async function createPayment() {
    if (!session) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ order_code: number; checkoutUrl: string; qrCode?: string | null }>(
        "/payment/create-qr",
        session.access_token,
        { method: "POST", body: JSON.stringify({ package: "premium_29k" }) }
      );
      const qrImage = result.qrCode ? await QRCode.toDataURL(result.qrCode, { width: 240, margin: 1 }) : null;
      setPayment({ order_code: result.order_code, checkoutUrl: result.checkoutUrl, qrImage });
      setPaymentStatus("Quét mã QR hoặc mở trang thanh toán. Hệ thống tự kiểm tra trạng thái mỗi 3 giây.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tạo mã thanh toán.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) {
    return <main className={`app-shell loading-shell ${theme === "dark" ? "theme-dark" : ""}`}><p>Đang kiểm tra phiên đăng nhập...</p></main>;
  }
  if (!session) return <AuthScreen onSession={setSession} theme={theme} onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")} />;

  const workspace = !!cvData && (editorOpen || !!analysis);

  return (
    <main className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      <header className="site-header no-print">
        <div className="header-inner">
          <Brand />
          <div className="header-actions">
            <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "light" ? "dark" : "light")} />
            <span className="header-divider" />
            <div className="profile-chip">
              <span className="avatar">{(profile?.full_name || session.user.email || "U").trim().charAt(0).toUpperCase()}</span>
              <span className="profile-name">{profile?.full_name || session.user.email}</span>
            </div>
            <span className="credits-chip">Credits <strong>{profile?.credits ?? "—"}</strong></span>
            <button className="text-button" onClick={() => void signOut()}>Đăng xuất</button>
          </div>
        </div>
      </header>

      <div className={`page-content ${workspace ? "page-wide" : ""}`}>
        {!workspace && <section className="hero">
          <p className="eyebrow">BƯỚC TIẾP THEO TRONG SỰ NGHIỆP CỦA BẠN</p>
          <h1>Tối Ưu Hóa Hồ Sơ<br /><span>Chinh Phục Nhà Tuyển Dụng</span></h1>
          <p>Hệ thống AI tự động đối chiếu CV với JD, xác định chính xác những điểm còn thiếu và gợi ý cách cải thiện hồ sơ.</p>
        </section>}

        {notice && <p role="status" className="notice notice-info no-print">{notice}</p>}

        {!workspace && <section className="input-grid" aria-label="Thông tin CV và mô tả công việc">
          <GlassCard className="input-card">
            <div className="section-heading">
              <span className="step-badge">1</span>
              <div><h2>Tải CV lên</h2><p>PDF · tối đa 5 MB</p></div>
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
                  <span className="file-info"><strong>{selectedFile.name}</strong><small>{cvId ? "Đã tải lên an toàn" : `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Sẵn sàng tải lên`}</small></span>
                  <span className="status-check" aria-label={cvId ? "Đã tải lên" : "Sẵn sàng"}>{cvId ? "✓" : "•"}</span>
                </div>
              )}
              <p className="privacy-note">Thông tin liên hệ sẽ được che trước khi gửi AI.</p>
              <button disabled={!selectedFile || busy} className="secondary-button">{busy && !cvId ? "Đang xử lý PDF..." : cvId ? "Tải CV khác" : "Tải CV lên"}</button>
            </form>
            <div className="cv-alt-actions">
              {cvId && <button type="button" disabled={loadingCv} className="secondary-button" onClick={() => session && void loadCv(cvId, session.access_token, true)}>{loadingCv ? "Đang chuẩn bị CV..." : "✎ Chỉnh sửa CV trên web"}</button>}
              <a href="/create" className="secondary-button link-button">＋ Hoặc tạo CV mới từ form</a>
            </div>
          </GlassCard>

          <GlassCard className="input-card">
            <div className="section-heading">
              <span className="step-badge">2</span>
              <div><h2>Dán mô tả công việc (JD)</h2><p>Thêm nội dung tuyển dụng bạn muốn ứng tuyển</p></div>
            </div>
            <form onSubmit={analyze}>
              <textarea
                required
                minLength={50}
                maxLength={20000}
                value={jd}
                onChange={(event) => setJd(event.target.value)}
                placeholder="Hãy dán nội dung tuyển dụng (JD) mà bạn muốn ứng tuyển vào đây..."
                className="jd-input"
              />
              <div className="input-meta"><span>Tối thiểu 50 ký tự</span><span>{jd.length.toLocaleString("vi-VN")}/20.000</span></div>
              <button disabled={!cvId || jd.trim().length < 50 || busy || !!payment} className="primary-button analyze-button">
                <span aria-hidden="true">✦</span>{busy && cvId ? ANALYSIS_STEPS[stepIndex % ANALYSIS_STEPS.length] : "Phân tích bằng AI"}
              </button>
            </form>
          </GlassCard>
        </section>}

        {workspace && cvData && (
        <div className="split-layout">
        <div className="split-left no-print">
          <div className="workspace-toolbar">
            <button type="button" className="text-button" onClick={() => setEditorOpen(false)} disabled={!!analysis}>← Quay lại</button>
            <div className="toolbar-actions">
              <button type="button" className="secondary-button" disabled={busy || rewriting !== null || !analysis} onClick={() => void optimizeAll()}>✨ Tối ưu toàn bộ CV</button>
              <button type="button" className="primary-button" disabled={busy || rewriting !== null || jd.trim().length < 50} onClick={() => void reanalyze()}>{busy ? "Đang phân tích..." : analysis ? "↻ Phân tích lại" : "✦ Phân tích bằng AI"}</button>
            </div>
          </div>
          <details className="jd-details" open={!analysis}>
            <summary>Mô tả công việc (JD)</summary>
            <textarea value={jd} maxLength={20000} onChange={(event) => setJd(event.target.value)} placeholder="Dán nội dung JD vào đây (tối thiểu 50 ký tự)..." className="jd-input" />
          </details>
          {undo && <p className="notice notice-info">AI vừa sửa một mục và đã đánh dấu trên CV. <button type="button" className="text-button" onClick={revertRewrite}>Hoàn tác</button> <button type="button" className="text-button" onClick={() => { setUndo(null); setHighlight(null); }}>Giữ thay đổi</button></p>}
        </div>
        <div className="split-left">
        {analysis && (
          <section className="results-section">
            <div className="results-heading">
              <div><p className="eyebrow">BÁO CÁO PHÂN TÍCH</p><h2>Phân tích mức độ phù hợp</h2><p>Đối chiếu theo Rubric 4 tầng tiêu chuẩn.</p></div>
              <div className="score-summary"><span>MỨC ĐỘ BAO PHỦ</span><strong>{prevScore !== null && prevScore !== analysis.rci_score && <small className="score-prev">{prevScore}% →</small>}{analysis.rci_score}<small>%</small></strong></div>
            </div>

            <div className="results-grid">
              <GlassCard className="result-card">
                <div className="section-heading"><span className="layer-icon layer-skills">✣</span><h3>Tầng 1: Kỹ năng</h3></div>
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
                <div className="section-heading"><span className="layer-icon layer-projects">▣</span><h3>Tầng 2: Dự án & bằng chứng</h3></div>
                {analysis.layer_2_projects.length ? <div className="project-list">
                  {analysis.layer_2_projects.map((project, index) => (
                    <article key={`${project.project_name}-${index}`} className="project-item">
                      <strong>{project.project_name}</strong>
                      <p><b>Điểm cần bổ sung:</b> {project.issue}</p>
                      <p><b>Gợi ý:</b> {project.suggestion}</p>
                      <blockquote className="evidence-quote">Bằng chứng từ CV: “{project.evidence}”</blockquote>
                      {(() => {
                        const target = cvData.projects.findIndex((item) => {
                          const a = item.name.trim().toLowerCase();
                          const b = project.project_name.trim().toLowerCase();
                          return a !== "" && (a.includes(b) || b.includes(a));
                        });
                        return target >= 0 ? <button type="button" className="mini-ai" disabled={rewriting !== null} onClick={() => void rewriteOne("projects", target, `${project.issue}. ${project.suggestion}`)}>{rewriting === `projects-${target}` ? "Đang viết..." : "✨ AI viết lại mục này"}</button> : null;
                      })()}
                    </article>
                  ))}
                </div> : <p className="empty-copy">AI chưa tìm thấy dự án cụ thể trong CV để nhận xét.</p>}
              </GlassCard>

              <GlassCard className="result-card">
                <div className="section-heading"><span className="layer-icon layer-education">◇</span><h3>Tầng 3: Học vấn & bằng cấp</h3></div>
                <div className="education-grid">
                  <div className={`education-item ${analysis.layer_3_education.major_matched ? "is-matched" : "is-unmatched"}`}>
                    <span>{analysis.layer_3_education.major_matched ? "✓" : "○"}</span><strong>Chuyên ngành</strong><small>{analysis.layer_3_education.major_matched ? "Phù hợp yêu cầu JD" : "Chưa có bằng chứng phù hợp"}</small>
                  </div>
                  <div className={`education-item ${analysis.layer_3_education.english_matched ? "is-matched" : "is-unmatched"}`}>
                    <span>{analysis.layer_3_education.english_matched ? "✓" : "○"}</span><strong>Ngoại ngữ</strong><small>{analysis.layer_3_education.english_matched ? "Đáp ứng yêu cầu tiếng Anh" : "Chưa có bằng chứng phù hợp"}</small>
                  </div>
                </div>
                <p className="education-notes">{analysis.layer_3_education.notes}</p>
                {analysis.layer_3_education.evidence.map((item, index) => <blockquote key={`${item.claim}-${index}`} className="evidence-quote"><strong>{item.claim}:</strong> “{item.quote}”</blockquote>)}
              </GlassCard>

              <GlassCard className="result-card interview-card">
                <div className="interview-title">
                  <div className="section-heading"><span className="layer-icon layer-interview">☏</span><h3>Tầng 4: Luyện phỏng vấn</h3></div>
                  {!analysis.layer_4_mock && <span className="premium-badge">PREMIUM</span>}
                </div>
                {analysis.layer_4_mock ? (
                  <ol className="question-list">{analysis.layer_4_mock.map((question, index) => <li key={`${index}-${question}`}><span>{String(index + 1).padStart(2, "0")}</span>{question}</li>)}</ol>
                ) : (
                  <>
                    <p className="interview-copy">Mở khóa 3 câu hỏi phỏng vấn mô phỏng, được AI cá nhân hóa theo khoảng trống kỹ năng và dự án trong CV.</p>
                    <button disabled={busy || !!payment} onClick={() => void createPayment()} className="unlock-button">♙ &nbsp; Mở khóa phiên phỏng vấn · 29.000đ</button>
                  </>
                )}
                {paymentStatus && <p role="status" className="payment-status">{paymentStatus}</p>}
                {payment && <div className="payment-panel">
                  {payment.qrImage && <img src={payment.qrImage} alt="Mã QR thanh toán PayOS" className="payment-qr" />}
                  <div><strong>Đơn hàng #{payment.order_code}</strong><p>Quét mã bằng ứng dụng ngân hàng hoặc mở trang thanh toán PayOS.</p><a href={payment.checkoutUrl} target="_blank" rel="noreferrer">Mở trang thanh toán ↗</a></div>
                </div>}
              </GlassCard>
            </div>
            <p className="results-disclaimer">♧ &nbsp; Dữ liệu liên hệ được ẩn danh. Điểm số không phản ánh xác suất trúng tuyển.</p>
          </section>
        )}
        </div>
        <aside className="split-right">
          <div className="cv-toolbar no-print">
            <strong>CV của bạn</strong>
            <span className={`save-state save-${saveState}`}>{saveState === "saved" ? "✓ Đã lưu" : saveState === "saving" ? "Đang lưu..." : saveState === "error" ? "Lỗi lưu · sẽ thử lại" : "Chưa lưu..."}</span>
            <button type="button" className="secondary-button" onClick={exportPdf}>⬇ Xuất PDF</button>
          </div>
          <div className="cv-scroll">
            <CvPaper cv={cvData} onChange={changeCv} highlight={highlight} rewriting={rewriting} onRewrite={(section, index) => void rewriteOne(section, index)} />
          </div>
        </aside>
        </div>
        )}

        <footer className="site-footer no-print"><span>AI Career Ready · Phân tích có trách nhiệm, không bịa đặt thông tin hồ sơ.</span><span>Còn lại {profile?.credits ?? "—"} credits</span></footer>
      </div>
    </main>
  );
}
