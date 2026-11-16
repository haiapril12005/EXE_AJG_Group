"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { imageFileToDataUrl } from "../../utils/image";
import { useApp } from "../app-frame";
import { DEMO_BILLING, usePlan } from "../plans";

// Styles follow the field of the job being applied for.
const FIELDS = [
  { id: "tech", label: "Công nghệ / Kỹ thuật", outfit: "Sơ mi sáng màu, smart casual", hint: "Gọn gàng, thân thiện" },
  { id: "finance", label: "Tài chính / Ngân hàng / Luật", outfit: "Vest tối màu, sơ mi trắng", hint: "Trang trọng, tin cậy" },
  { id: "business", label: "Kinh doanh / Marketing", outfit: "Blazer, áo sơ mi", hint: "Năng động, chuyên nghiệp" },
  { id: "creative", label: "Thiết kế / Sáng tạo", outfit: "Áo len hoặc blazer cá tính", hint: "Hiện đại, có cá tính" },
  { id: "health", label: "Y tế / Giáo dục", outfit: "Sơ mi, áo cổ đức trang nhã", hint: "Ân cần, đáng tin" }
] as const;

const BACKGROUNDS = [
  { id: "studio-gray", label: "Xám studio", color: "#d9dde3" },
  { id: "navy", label: "Xanh navy", color: "#1f3a5f" },
  { id: "white", label: "Trắng", color: "#f8fafc" },
  { id: "office", label: "Văn phòng mờ", color: "linear-gradient(135deg, #c9d6df, #e8eef2 45%, #b8c4cc)" }
] as const;

const KEEP = ["Khuôn mặt & đường nét", "Kiểu tóc & màu da", "Biểu cảm tự nhiên"];
const STEPS = ["Đang phân tích khuôn mặt...", "Giữ nguyên đường nét...", "Thay trang phục...", "Hoàn thiện nền & ánh sáng..."];

type FieldId = (typeof FIELDS)[number]["id"];
type BackgroundId = (typeof BACKGROUNDS)[number]["id"];

export default function PhotoStudioPage() {
  const { session } = useApp();
  const { remaining, consume, isPro, plan } = usePlan(session.user.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [field, setField] = useState<FieldId>("tech");
  const [background, setBackground] = useState<BackgroundId>("studio-gray");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ id: number; label: string }[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const left = remaining("photos");
  const fieldInfo = FIELDS.find((item) => item.id === field)!;
  const backgroundInfo = BACKGROUNDS.find((item) => item.id === background)!;

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => setProgress((value) => Math.min(100, value + 4)), 120);
    return () => window.clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    if (!generating || progress < 100) return;
    setGenerating(false);
    setResults([1, 2, 3, 4].map((id) => ({ id, label: `Phương án ${id}` })));
    setChosen(1);
  }, [generating, progress]);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      setPhoto(await imageFileToDataUrl(file, { width: 600, height: 800 }));
      setResults([]);
      setChosen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được ảnh.");
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files[0]);
  }

  function generate() {
    if (!photo || !consent || generating) return;
    if (!consume("photos")) {
      setError("Bạn đã dùng hết lượt tạo ảnh của gói hiện tại.");
      return;
    }
    // DEMO: the image model is not connected yet; the results show the uploaded photo on the chosen backdrop.
    setError("");
    setResults([]);
    setProgress(0);
    setGenerating(true);
  }

  const canGenerate = Boolean(photo) && consent && !generating && left > 0;

  return (
    <>
      <section className="page-heading studio-heading">
        <div>
          <p className="eyebrow">ẢNH CV AI</p>
          <h1>Ảnh CV chuyên nghiệp từ ảnh của chính bạn</h1>
          <p>AI giữ nguyên khuôn mặt và thần thái, chỉ thay trang phục và phông nền cho phù hợp với ngành bạn ứng tuyển.</p>
        </div>
        <div className="studio-quota">
          <span>{isPro ? plan.name : "Gói miễn phí"}</span>
          <strong>{left}</strong>
          <small>lượt tạo ảnh còn lại</small>
          {!isPro && <Link href="/pricing" className="inline-link">Nâng cấp để có 10 lượt →</Link>}
        </div>
      </section>

      <div className="studio-layout">
        <div className="studio-controls">
          <section className="soft-card studio-card" aria-label="Ảnh gốc">
            <div className="section-heading"><span className="step-badge">1</span><div><h2>Tải ảnh chân dung</h2><p>Ảnh rõ mặt, nhìn thẳng, một người trong khung hình</p></div></div>
            <button
              type="button"
              className={`drop-area studio-drop${dragging ? " is-dragging" : ""}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {photo ? (
                <img src={photo} alt="Ảnh gốc của bạn" className="studio-source" />
              ) : (
                <>
                  <span className="upload-icon" aria-hidden="true">↑</span>
                  <strong>Kéo thả ảnh vào đây</strong>
                  <span>JPG, PNG hoặc WebP · tối đa 10 MB</span>
                  <span className="choose-file">Chọn ảnh</span>
                </>
              )}
            </button>
            {photo && <button type="button" className="text-button" onClick={() => fileInput.current?.click()}>Đổi ảnh khác</button>}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" aria-label="Chọn ảnh chân dung"
              onChange={(event: ChangeEvent<HTMLInputElement>) => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
            <label className="studio-consent">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>Tôi xác nhận đây là ảnh của chính tôi và đồng ý để AI xử lý ảnh. Ảnh gốc được xóa ngay sau khi tạo xong.</span>
            </label>
          </section>

          <section className="soft-card studio-card" aria-label="Phong cách">
            <div className="section-heading"><span className="step-badge">2</span><div><h2>Ngành ứng tuyển</h2><p>Trang phục được chọn theo ngành</p></div></div>
            <div className="studio-fields" role="radiogroup" aria-label="Ngành ứng tuyển">
              {FIELDS.map((item) => (
                <label key={item.id} className={`studio-field${field === item.id ? " is-selected" : ""}`}>
                  <input type="radio" name="field" checked={field === item.id} onChange={() => setField(item.id)} />
                  <strong>{item.label}</strong>
                  <small>{item.outfit}</small>
                </label>
              ))}
            </div>
            <h3 className="studio-subtitle">Phông nền</h3>
            <div className="studio-backgrounds" role="radiogroup" aria-label="Phông nền">
              {BACKGROUNDS.map((item) => (
                <label key={item.id} className={`studio-bg${background === item.id ? " is-selected" : ""}`}>
                  <input type="radio" name="background" checked={background === item.id} onChange={() => setBackground(item.id)} />
                  <span className="studio-swatch" style={{ background: item.color }} aria-hidden="true" />
                  <small>{item.label}</small>
                </label>
              ))}
            </div>
          </section>

          <section className="soft-card studio-card studio-generate" aria-label="Tạo ảnh">
            <div className="studio-keep">
              <span>AI luôn giữ nguyên:</span>
              {KEEP.map((item) => <b key={item}>✓ {item}</b>)}
            </div>
            {error && <p role="status" className="notice notice-info">{error}</p>}
            {left === 0 ? (
              <Link href="/pricing" className="primary-button link-button">Nâng cấp Pro để tạo thêm ảnh</Link>
            ) : (
              <button type="button" className="primary-button" disabled={!canGenerate} onClick={generate}>
                {generating ? "Đang tạo ảnh..." : "✦ Tạo 4 phương án · dùng 1 lượt"}
              </button>
            )}
            {!photo && <p className="studio-hint">Tải ảnh lên để bắt đầu.</p>}
            {photo && !consent && <p className="studio-hint">Hãy xác nhận đây là ảnh của bạn.</p>}
          </section>
        </div>

        <section className="soft-card studio-preview" aria-label="Kết quả">
          <div className="studio-preview-head">
            <h2>Kết quả</h2>
            <span>{fieldInfo.hint} · {backgroundInfo.label}</span>
          </div>

          {generating && (
            <div className="studio-progress" role="status">
              <div className="studio-progress-bar"><span style={{ width: `${progress}%` }} /></div>
              <p>{STEPS[Math.min(STEPS.length - 1, Math.floor(progress / 25))]}</p>
              <div className="studio-results">
                {[1, 2, 3, 4].map((id) => <div key={id} className="studio-result is-loading" aria-hidden="true" />)}
              </div>
            </div>
          )}

          {!generating && results.length === 0 && (
            <div className="studio-empty">
              <div className="studio-empty-frame" style={{ background: backgroundInfo.color }}>
                {photo ? <img src={photo} alt="" /> : <span aria-hidden="true">👤</span>}
              </div>
              <p>Ảnh 3×4 chuẩn CV sẽ hiện ở đây. Chọn ngành và phông nền rồi bấm <b>Tạo</b>.</p>
              <ul className="studio-tips">
                <li>Ánh sáng đều, không đeo kính râm</li>
                <li>Nhìn thẳng, thấy rõ vai</li>
                <li>Không dùng ảnh đã qua filter làm đẹp</li>
              </ul>
            </div>
          )}

          {!generating && results.length > 0 && photo && (
            <>
              <div className="studio-results" role="radiogroup" aria-label="Chọn phương án">
                {results.map((result) => (
                  <label key={result.id} className={`studio-result${chosen === result.id ? " is-selected" : ""}`} style={{ background: backgroundInfo.color }}>
                    <input type="radio" name="result" checked={chosen === result.id} onChange={() => setChosen(result.id)} />
                    <img src={photo} alt={result.label} style={{ objectPosition: `50% ${20 + result.id * 6}%` }} />
                    <span>{result.label}</span>
                  </label>
                ))}
              </div>
              {DEMO_BILLING && (
                <p className="studio-demo" role="note"><b>Bản xem trước (demo)</b> — mô hình AI chưa được kết nối nên ảnh hiển thị là ảnh gốc trên phông nền đã chọn.</p>
              )}
              <div className="studio-actions">
                <a className="primary-button link-button" href={photo} download={`anh-cv-${field}.jpg`}>Tải ảnh đã chọn</a>
                <Link className="secondary-button link-button" href="/create">Dùng cho CV →</Link>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
