"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../utils/api";
import { analysisLabel, shortDate, type ListPage, type SavedAnalysis, type SavedCv } from "../../utils/history";
import { useApp } from "../app-frame";

type SavedEvaluation = { id: string; cv_id: string; quality_score: number; created_at: string; cv_name: string | null };
type SavedInterview = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  created_at: string;
  jd_preview: string;
  cv_name?: string | null;
  answered: number;
  total: number;
  overall_score: number | null;
};

type Paged<T> = { items: T[]; total: number; page: number };

/** Loads one history list page by page; page 1 replaces what is shown, later pages append. */
function usePagedList<T>(path: string, key: string) {
  const { token } = useApp();
  const [list, setList] = useState<Paged<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  async function load(page: number) {
    setLoading(true);
    try {
      const result = await api<ListPage & Record<string, unknown>>(`${path}?page=${page}`, tokenRef.current);
      const items = (result[key] ?? []) as T[];
      setList((current) => ({
        items: page === 1 ? items : [...(current?.items ?? []), ...items],
        total: result.total ?? items.length,
        page
      }));
    } finally {
      setLoading(false);
    }
  }

  return { list, loading, load };
}

function HistoryList<T extends { id: string }>({ title, empty, state, onMore, render }: {
  title: string;
  empty: string;
  state: ReturnType<typeof usePagedList<T>>;
  onMore: () => void;
  render: (item: T) => ReactNode;
}) {
  const { list, loading } = state;
  return (
    <section className="soft-card"><h3>{title}{list && list.total > 0 && <small className="history-count"> · {list.total}</small>}</h3>
      {list && (list.items.length ? list.items.map((item) => <Fragment key={item.id}>{render(item)}</Fragment>) : <p className="empty-copy">{empty}</p>)}
      {list && list.items.length < list.total && <button type="button" className="text-button history-more" disabled={loading} onClick={onMore}>
        {loading ? "Đang tải..." : `Tải thêm (${list.total - list.items.length})`}
      </button>}
    </section>
  );
}

export default function HistoryPage() {
  const { token } = useApp();
  const cvs = usePagedList<SavedCv>("/cv", "cvs");
  const analyses = usePagedList<SavedAnalysis>("/analyses", "analyses");
  const evaluations = usePagedList<SavedEvaluation>("/evaluations", "evaluations");
  const interviews = usePagedList<SavedInterview>("/interviews", "sessions");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function loadAll() {
    // Evaluations are optional: an older database without them still shows the rest.
    const optional = evaluations.load(1).catch(() => undefined);
    await Promise.all([cvs.load(1), analyses.load(1), interviews.load(1), optional]);
  }

  useEffect(() => {
    void loadAll().catch((error: Error) => setNotice(error.message)).finally(() => setReady(true));
    // A refreshed token does not change the history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function more<T>(state: ReturnType<typeof usePagedList<T>>) {
    return () => void state.load((state.list?.page ?? 0) + 1).catch((error: Error) => setNotice(error.message));
  }

  async function deleteCv(cv: SavedCv) {
    const confirmed = window.confirm(`Xóa “${cv.original_name}”?\n\nCác báo cáo phân tích, lần đánh giá và phiên phỏng vấn dùng CV này cũng bị xóa. Không thể hoàn tác.`);
    if (!confirmed) return;
    setDeleting(cv.id);
    setNotice("");
    try {
      await api(`/cv/${cv.id}`, token, { method: "DELETE" });
      await loadAll();
      setNotice(`Đã xóa “${cv.original_name}” và dữ liệu đi kèm.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không xóa được CV.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">LỊCH SỬ</p>
        <h1>Hồ sơ, báo cáo và phỏng vấn của bạn</h1>
      </section>
      {notice && <p role="status" className="notice notice-info">{notice}</p>}
      {!ready && <p className="muted-copy">Đang tải lịch sử...</p>}
      {ready && <div className="history-grid history-grid-wide">
        <HistoryList title="CV đã lưu" empty="Chưa có CV nào." state={cvs} onMore={more(cvs)} render={(item) =>
          <div className="history-row">
            <Link href={`/cv/${item.id}`} className="history-item">
              <strong>{item.original_name}</strong><small>{shortDate(item.created_at)}</small>
            </Link>
            <button type="button" className="text-button history-delete" disabled={deleting !== null}
              aria-label={`Xóa ${item.original_name}`} onClick={() => void deleteCv(item)}>
              {deleting === item.id ? "Đang xóa..." : "Xóa"}
            </button>
          </div>} />
        <HistoryList title="Báo cáo phân tích" empty="Chưa có báo cáo nào." state={analyses} onMore={more(analyses)} render={(item) =>
          <Link href={`/analysis/${item.id}`} className="history-item">
            <strong>Phù hợp {item.rci_score}%</strong><small>{shortDate(item.created_at)} · {analysisLabel(item)}</small>
          </Link>} />
        <HistoryList title="Đánh giá chất lượng CV" empty="Chưa có lần đánh giá nào." state={evaluations} onMore={more(evaluations)} render={(item) =>
          <Link href={`/cv/${item.cv_id}?evaluation=${item.id}`} className="history-item">
            <strong>Chất lượng {item.quality_score}/100</strong><small>{shortDate(item.created_at)}{item.cv_name ? ` · ${item.cv_name}` : ""}</small>
          </Link>} />
        <HistoryList title="Phiên phỏng vấn" empty="Chưa có phiên phỏng vấn nào." state={interviews} onMore={more(interviews)} render={(item) =>
          <Link href={`/interview/${item.id}`} className="history-item">
            <strong>{item.overall_score !== null ? `Điểm ${item.overall_score}/100` : `Đã trả lời ${item.answered}/${item.total} câu`}</strong>
            <small>{shortDate(item.created_at)} · {item.cv_name ? `${item.cv_name} · ` : ""}{item.jd_preview}...</small>
          </Link>} />
      </div>}
    </>
  );
}
