"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../utils/api";
import { useApp } from "../app-frame";

type Job = { id: string; company: string; title: string; location: string; city: string; url: string; posted_at: string | null };
type JobPage = { jobs: Job[]; total: number; page: number; page_size: number };

const CITIES = ["Hồ Chí Minh", "Hà Nội", "Đà Nẵng", "Việt Nam"];

export default function JobsPage() {
  const { token } = useApp();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<JobPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);
    if (city) params.set("city", city);
    void api<JobPage>(`/jobs?${params}`, token).then((next) => {
      if (!active) return;
      setResult(next);
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
  }, [query, city, page]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(draft.trim());
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
        <p>Tin tuyển dụng tại Việt Nam lấy từ trang tuyển dụng chính thức của công ty và tự cập nhật định kỳ. Thông tin liên hệ trong tin được che trước khi lưu.</p>
      </section>

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
      {result && <p className="job-count">{result.total.toLocaleString("vi-VN")} việc làm</p>}
      {result && result.total === 0 && <p className="empty-copy">Không có việc làm phù hợp. Mỗi từ khóa phải xuất hiện trong tiêu đề, tên công ty hoặc mô tả; hãy bớt từ khóa. Nếu kho còn trống, API sẽ tự nạp tin sau khi khởi động, hoặc chạy npm run jobs:sync.</p>}

      <div className="job-list">
        {result?.jobs.map((job) => <article key={job.id} className="soft-card job-card">
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
            <a href={job.url} target="_blank" rel="noreferrer" className="inline-link">Tin gốc ↗</a>
          </div>
          {openJob === job.id && <p className="job-description">{descriptions[job.id] ?? "Đang tải mô tả..."}</p>}
        </article>)}
      </div>

      {result && lastPage > 1 && <nav className="job-pager" aria-label="Phân trang">
        <button type="button" className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>← Trước</button>
        <span>Trang {page}/{lastPage}</span>
        <button type="button" className="secondary-button" disabled={page >= lastPage || loading} onClick={() => setPage(page + 1)}>Sau →</button>
      </nav>}
    </>
  );
}
