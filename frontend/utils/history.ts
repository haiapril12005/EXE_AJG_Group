export type SavedCv = { id: string; original_name: string; created_at: string };

export type SavedAnalysis = {
  id: string;
  cv_id: string;
  rci_score: number;
  created_at: string;
  jd_preview: string;
  cv_name: string | null;
  job: { title: string; company: string } | null;
};

/** History lists come back 20 at a time with the overall total. */
export type ListPage = { total: number; page: number; page_size: number };

/** One line saying which CV and JD a saved report compared. */
export function analysisLabel(item: SavedAnalysis): string {
  const target = item.job ? `${item.job.title} · ${item.job.company}` : `${item.jd_preview.slice(0, 60)}...`;
  return item.cv_name ? `${item.cv_name} → ${target}` : target;
}

export const shortDate = (value: string) => new Date(value).toLocaleDateString("vi-VN");
