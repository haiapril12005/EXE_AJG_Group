// Shapes returned by the /api/admin/* endpoints (backend/src/admin.ts and adminAnalytics.ts).

export type TxStatus = "PENDING" | "SUCCESS" | "CANCELLED";

export const TX_STATUS_LABELS: Record<TxStatus, string> = {
  SUCCESS: "Thành công",
  PENDING: "Đang chờ",
  CANCELLED: "Đã hủy"
};

export type AdminOverview = {
  generated_at: string;
  rules: { max_admins: number; current_admins: number; remaining_slots: number };
  users: { total: number; admins: number; new_last_7d: number; total_credits: number };
  cvs: { total: number; evaluations_total: number; avg_quality_score: number | null };
  analyses: { total: number; avg_rci_score: number | null; high_match_count: number };
  interviews: { total: number; completed: number; in_progress: number; answers_total: number };
  revenue: {
    total_vnd: number;
    success_count: number;
    pending_count: number;
    cancelled_count: number;
    recent_transactions: { order_code: number; amount: number; status: TxStatus; created_at: string; user_email: string | null }[];
  };
  jobs: { active_count: number; last_seen_at: string | null };
  admins: { id: string; user_code?: string; email: string; full_name: string; created_at: string }[];
};

export type PeriodTotals = { new_users: number; analyses: number; interviews: number; cvs: number };

export type AdminActivity = {
  days: number;
  daily: ({ day: string } & PeriodTotals)[];
  current: PeriodTotals;
  previous: PeriodTotals;
  funnel: { signed_up: number; has_cv: number; analyzed: number; interviewed: number; paid: number; active_7d: number };
};

type UsageTotals = { calls: number; failed: number; input_tokens: number; output_tokens: number; thought_tokens: number; total_tokens: number; cost_vnd: number };

export type AiUsageReport = {
  days: number;
  pricing: { inputUsdPerM: number; outputUsdPerM: number; usdVnd: number };
  totals: UsageTotals & { avg_latency_ms: number };
  daily: { day: string; total_tokens: number; calls: number; cost_vnd: number }[];
  by_feature: (UsageTotals & { feature: string; label: string; avg_cost_vnd: number })[];
  by_model: (UsageTotals & { model: string })[];
  top_users: { id: string; user_code: string; email: string; full_name: string; calls: number; total_tokens: number; cost_vnd: number }[];
};

export type AdminUserRow = {
  id: string; user_code?: string; email: string; full_name: string; credits: number; is_admin: boolean; created_at: string;
};

export type AdminUserDetail = {
  user: { id: string; user_code: string; email: string; full_name: string; phone: string; credits: number; is_admin: boolean; created_at: string };
  counts: { cvs: number; analyses: number; interviews: number; transactions_success: number };
  recent_analyses: { id: string; rci_score: number | null; created_at: string }[];
  transactions: { order_code: number; amount: number; status: TxStatus; created_at: string }[];
  ai_30d: { calls: number; total_tokens: number; cost_vnd: number } | null;
};

export type AdminTransactionPage = {
  transactions: { order_code: number; amount: number; status: TxStatus; created_at: string; user_email: string | null; user_code: string | null }[];
  total: number;
  page: number;
  page_size: number;
};

export type AdminJobStats = {
  active: number;
  inactive: number;
  last_seen_at: string | null;
  by_source: { source: string; active: number }[];
  by_category: { category: string; label: string; active: number }[];
};
