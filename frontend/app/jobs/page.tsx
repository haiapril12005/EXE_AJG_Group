"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../utils/api";
import { useApp } from "../app-frame";

type Job = { id: string; company: string; title: string; location: string; city: string; url: string; posted_at: string | null };
type JobPage = { jobs: Job[]; total: number; page: number; page_size: number; saved_ids?: string[] };

const CITIES = ["Hồ Chí Minh", "Hà Nội", "Đà Nẵng", "Việt Nam"];

export default function JobsPage() {
  const { token } = useApp();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [onlySaved, setOnlySaved] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<JobPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("saved") === "1" || params.get("saved") === "true") {
      setOnlySaved(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);
    if (city) params.set("city", city);
    if (onlySaved) params.set("saved", "1");
    void api<JobPage>(`/jobs?${params}`, token).then((next) => {
      if (!active) return;
      setResult(next);
      if (Array.isArray(next.saved_ids)) {
        setSavedIds(next.saved_ids);
      }
      setNotice("");
    }).catch((error: Error) => {
      if (!active) return;
      setResult(null);
      setNotice(error.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
    // A refreshed token does not change the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, city, onlySaved, page]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(draft.trim());
  }

  function switchTab(savedMode: boolean) {
    if (onlySaved === savedMode) return;
    setPage(1);
    setOnlySaved(savedMode);
  }

  async function toggleSaveJob(jobId: string) {
    if (savingId === jobId) return;
    const isCurrentlySaved = savedIds.includes(jobId);
    setSavingId(jobId);
    try {
      const response = await api<{ saved: boolean; saved_ids: string[] }>(`/jobs/${jobId}/save`, token, {
        method: isCurrentlySaved ? "DELETE" : "POST"
      });
      setSavedIds(response.saved_ids);
      if (onlySaved && isCurrentlySaved) {
        setResult((current) =>
          current
            ? {
                ...current,
                jobs: current.jobs.filter((item) => item.id !== jobId),
                total: Math.max(0, current.total - 1)
              }
            : current
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể cập nhật mục Xem sau.");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleJob(id: string) {
    if (openJob === id) {
      setOpenJob(null);
      return;
    }
    setOpenJob(id);
    if (descriptions[id]) return;
    try {
      const { job } = await api<{ job: { description: string } }>(`/jobs/${id}`, token);
      setDescriptions((current) => ({ ...current, [id]: job.description }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không mở được mô tả công việc.");
    }
  }

  const lastPage = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1;

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">KHO VIỆC LÀM</p>
        <h1>Chọn công việc bạn muốn ứng tuyển</h1>
        <p>Tin tuyển dụng tại Việt Nam lấy từ trang tuyển dụng chính thức của công ty và tự cập nhật định kỳ. Bạn có thể lưu công việc vào mục Xem sau để ứng tuyển bất cứ lúc nào.</p>
      </section>

      <div className="job-tabs" role="tablist" aria-label="Chế độ xem việc làm">
        <button
          type="button"
          role="tab"
          aria-selected={!onlySaved}
          className={`job-tab ${!onlySaved ? "is-active" : ""}`}
          onClick={() => switchTab(false)}
        >
          Tất cả việc làm
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onlySaved}
          className={`job-tab ${onlySaved ? "is-active" : ""}`}
          onClick={() => switchTab(true)}
        >
          ★ Xem sau · Đã lưu ({savedIds.length})
        </button>
      </div>

      <form className="job-filters" onSubmit={search} role="search">
        <input className="form-input" type="search" value={draft} maxLength={100} onChange={(event) => setDraft(event.target.value)}
          placeholder="Vị trí, công ty hoặc kỹ năng (vd: backend typescript)" aria-label="Tìm việc làm" />
        <select className="form-input" value={city} aria-label="Khu vực" onChange={(event) => { setPage(1); setCity(event.target.value); }}>
          <option value="">Tất cả khu vực</option>
          {CITIES.map((item) => <option key={item} value={item}>{item === "Việt Nam" ? "Việt Nam (khác)" : item}</option>)}
        </select>
        <button className="primary-button">Tìm</button>
      </form>

      {notice && <p role="status" className="notice notice-info">{notice}</p>}
      {loading && !result && <p className="muted-copy">Đang tải việc làm...</p>}
      {result && (
        <p className="job-count">
          {onlySaved
            ? `${result.total.toLocaleString("vi-VN")} việc làm đã lưu để xem sau`
            : `${result.total.toLocaleString("vi-VN")} việc làm`}
        </p>
      )}
      {result && result.total === 0 && (
        onlySaved ? (
          <div className="soft-card job-empty-saved">
            <p className="empty-copy">
              Bạn chưa lưu công việc nào vào mục <strong>Xem sau</strong>. Khi thấy công việc muốn ứng tuyển, hãy bấm <strong>“☆ Lưu xem sau”</strong> trên thẻ việc làm — danh sách này được gắn với tài khoản của bạn và giữ nguyên mỗi khi đăng nhập lại.
            </p>
            <button type="button" className="secondary-button" onClick={() => switchTab(false)}>
              Khám phá tất cả việc làm
            </button>
          </div>
        ) : (
          <p className="empty-copy">Không có việc làm phù hợp. Mỗi từ khóa phải xuất hiện trong tiêu đề, tên công ty hoặc mô tả; hãy bớt từ khóa. Nếu kho còn trống, API sẽ tự nạp tin sau khi khởi động, hoặc chạy npm run jobs:sync.</p>
        )
      )}

      <div className="job-list">
        {result?.jobs.map((job) => {
          const isSaved = savedIds.includes(job.id);
          return (
            <article key={job.id} className="soft-card job-card">
              <div className="job-card-heading">
                <div>
                  <h2>{job.title}</h2>
                  <p>{job.company} · {job.location || job.city}</p>
                </div>
                {job.posted_at && <small>{new Date(job.posted_at).toLocaleDateString("vi-VN")}</small>}
              </div>
              <div className="job-card-actions">
                <Link href={`/?job=${job.id}`} className="primary-button">Phân tích với CV của tôi</Link>
                <button type="button" className="secondary-button" aria-expanded={openJob === job.id} onClick={() => void toggleJob(job.id)}>{openJob === job.id ? "Ẩn mô tả" : "Xem mô tả"}</button>
                <button
                  type="button"
                  className={`secondary-button job-save-button ${isSaved ? "is-saved" : ""}`}
                  aria-pressed={isSaved}
                  disabled={savingId === job.id}
                  onClick={() => void toggleSaveJob(job.id)}
                >
                  {isSaved ? "★ Đã lưu" : "☆ Lưu xem sau"}
                </button>
                <a href={job.url} target="_blank" rel="noreferrer" className="inline-link">Tin gốc ↗</a>
              </div>
              {openJob === job.id && <p className="job-description">{descriptions[job.id] ?? "Đang tải mô tả..."}</p>}
            </article>
          );
        })}
      </div>

      {result && lastPage > 1 && <nav className="job-pager" aria-label="Phân trang">
        <button type="button" className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>← Trước</button>
        <span>Trang {page}/{lastPage}</span>
        <button type="button" className="secondary-button" disabled={page >= lastPage || loading} onClick={() => setPage(page + 1)}>Sau →</button>
      </nav>}
    </>
  );
}
