import { AI_FEATURES, currentPricing, estimateCostVnd, type Pricing } from "./aiUsage";
import { userCodeOf } from "./admin";
import { HttpError } from "./errors";
import { JOB_CATEGORIES } from "./jobs/categories";
import { supabase } from "./supabase";

export const MIGRATION_011 = "011_admin_analytics.sql";
export const ADMIN_TX_PAGE_SIZE = 20;

type DbError = { code?: string; message?: string } | null;

/** A missing reporting function or table means migration 011 has not been applied yet. */
function failIfMissing(error: DbError): void {
  if (!error) return;
  if (error.code === "PGRST202" || error.code === "PGRST205" || /admin_|ai_usage/.test(error.message ?? "")) {
    throw new HttpError(503, `Số liệu nâng cao chưa sẵn sàng. Hãy chạy migration ${MIGRATION_011} trong Supabase.`);
  }
  throw error;
}

// ---------- Activity & funnel ----------

export type DailyActivity = { day: string; new_users: number; analyses: number; interviews: number; cvs: number };
export type Funnel = { signed_up: number; has_cv: number; analyzed: number; interviewed: number; paid: number; active_7d: number };
export type PeriodTotals = { new_users: number; analyses: number; interviews: number; cvs: number };
export type AdminActivity = {
  days: number;
  daily: DailyActivity[];
  /** Totals of the last `days` days and of the `days` before them, for the change badges. */
  current: PeriodTotals;
  previous: PeriodTotals;
  funnel: Funnel;
};

const num = (value: unknown) => Number(value) || 0;

export function sumPeriod(rows: DailyActivity[]): PeriodTotals {
  return rows.reduce((total, row) => ({
    new_users: total.new_users + row.new_users,
    analyses: total.analyses + row.analyses,
    interviews: total.interviews + row.interviews,
    cvs: total.cvs + row.cvs
  }), { new_users: 0, analyses: 0, interviews: 0, cvs: 0 });
}

/** Splits 2×`days` daily rows into the shown period and the one before it. */
export function buildActivity(days: number, rows: Record<string, unknown>[], funnelRow: Record<string, unknown> | null): AdminActivity {
  const daily = rows.map((row) => ({
    day: String(row.day),
    new_users: num(row.new_users),
    analyses: num(row.analyses),
    interviews: num(row.interviews),
    cvs: num(row.cvs)
  }));
  const shown = daily.slice(-days);
  const before = daily.slice(0, Math.max(0, daily.length - days));
  return {
    days,
    daily: shown,
    current: sumPeriod(shown),
    previous: sumPeriod(before),
    funnel: {
      signed_up: num(funnelRow?.signed_up),
      has_cv: num(funnelRow?.has_cv),
      analyzed: num(funnelRow?.analyzed),
      interviewed: num(funnelRow?.interviewed),
      paid: num(funnelRow?.paid),
      active_7d: num(funnelRow?.active_7d)
    }
  };
}

export async function fetchAdminActivity(days: number): Promise<AdminActivity> {
  const [daily, funnel] = await Promise.all([
    supabase.rpc("admin_daily_activity", { p_days: days * 2 }),
    supabase.rpc("admin_funnel").maybeSingle()
  ]);
  failIfMissing(daily.error);
  failIfMissing(funnel.error);
  return buildActivity(days, (daily.data ?? []) as Record<string, unknown>[], funnel.data as Record<string, unknown> | null);
}

// ---------- AI usage ----------

type UsageTotals = { calls: number; failed: number; input_tokens: number; output_tokens: number; thought_tokens: number; total_tokens: number; cost_vnd: number };
export type AiUsageReport = {
  days: number;
  pricing: Pricing;
  totals: UsageTotals & { avg_latency_ms: number };
  daily: { day: string; total_tokens: number; calls: number; cost_vnd: number }[];
  by_feature: (UsageTotals & { feature: string; label: string; avg_cost_vnd: number })[];
  by_model: (UsageTotals & { model: string })[];
  top_users: { id: string; user_code: string; email: string; full_name: string; calls: number; total_tokens: number; cost_vnd: number }[];
};

const emptyTotals = (): UsageTotals => ({ calls: 0, failed: 0, input_tokens: 0, output_tokens: 0, thought_tokens: 0, total_tokens: 0, cost_vnd: 0 });

function addRow(target: UsageTotals, row: Record<string, unknown>, pricing: Pricing): void {
  const input = num(row.input_tokens);
  const output = num(row.output_tokens);
  const thought = num(row.thought_tokens);
  target.calls += num(row.calls);
  target.failed += num(row.failed);
  target.input_tokens += input;
  target.output_tokens += output;
  target.thought_tokens += thought;
  target.total_tokens += num(row.total_tokens);
  target.cost_vnd += estimateCostVnd({ input, output, thought }, pricing);
}

/** Every day of the period appears in `daily`, with zeros on days without AI calls. */
export function buildAiUsageReport(
  days: number,
  rows: Record<string, unknown>[],
  topRows: Record<string, unknown>[],
  people: Map<string, { user_code?: string | null; email: string; full_name: string }>,
  pricing: Pricing,
  today = new Date()
): AiUsageReport {
  const totals = emptyTotals();
  let latencyWeighted = 0;
  const byDay = new Map<string, UsageTotals>();
  const byFeature = new Map<string, UsageTotals>();
  const byModel = new Map<string, UsageTotals>();
  for (const row of rows) {
    addRow(totals, row, pricing);
    latencyWeighted += num(row.avg_latency_ms) * num(row.calls);
    for (const [map, key] of [[byDay, String(row.day)], [byFeature, String(row.feature)], [byModel, String(row.model)]] as const) {
      const entry = map.get(key) ?? emptyTotals();
      addRow(entry, row, pricing);
      map.set(key, entry);
    }
  }

  const daily: AiUsageReport["daily"] = [];
  const vietnamToday = new Date(today.getTime() + 7 * 3600_000);
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(vietnamToday.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    const entry = byDay.get(day);
    daily.push({ day, total_tokens: entry?.total_tokens ?? 0, calls: entry?.calls ?? 0, cost_vnd: entry?.cost_vnd ?? 0 });
  }

  const labels = AI_FEATURES as Record<string, string>;
  return {
    days,
    pricing,
    totals: { ...totals, avg_latency_ms: totals.calls ? Math.round(latencyWeighted / totals.calls) : 0 },
    daily,
    by_feature: [...byFeature].map(([feature, entry]) => ({
      feature,
      label: labels[feature] ?? feature,
      ...entry,
      avg_cost_vnd: entry.calls ? entry.cost_vnd / entry.calls : 0
    })).sort((a, b) => b.cost_vnd - a.cost_vnd),
    by_model: [...byModel].map(([model, entry]) => ({ model, ...entry })).sort((a, b) => b.cost_vnd - a.cost_vnd),
    top_users: topRows.map((row) => {
      const id = String(row.user_id);
      const person = people.get(id);
      return {
        id,
        user_code: userCodeOf({ id, user_code: person?.user_code }),
        email: person?.email ?? "",
        full_name: person?.full_name ?? "",
        calls: num(row.calls),
        total_tokens: num(row.total_tokens),
        cost_vnd: estimateCostVnd({ input: num(row.input_tokens), output: num(row.output_tokens), thought: num(row.thought_tokens) }, pricing)
      };
    })
  };
}

export async function fetchAiUsageReport(days: number): Promise<AiUsageReport> {
  const [usage, top] = await Promise.all([
    supabase.rpc("admin_ai_usage", { p_days: days }),
    supabase.rpc("admin_ai_top_users", { p_days: days, p_limit: 10 })
  ]);
  failIfMissing(usage.error);
  failIfMissing(top.error);
  const topRows = (top.data ?? []) as Record<string, unknown>[];
  const people = new Map<string, { user_code?: string | null; email: string; full_name: string }>();
  const ids = topRows.map((row) => String(row.user_id));
  if (ids.length) {
    const { data, error } = await supabase.from("users").select("id,user_code,email,full_name").in("id", ids);
    if (error) throw error;
    for (const row of data ?? []) people.set(row.id, row);
  }
  return buildAiUsageReport(days, (usage.data ?? []) as Record<string, unknown>[], topRows, people, currentPricing());
}

// ---------- One user ----------

export type AdminUserDetail = {
  user: { id: string; user_code: string; email: string; full_name: string; phone: string; credits: number; is_admin: boolean; created_at: string };
  counts: { cvs: number; analyses: number; interviews: number; transactions_success: number };
  recent_analyses: { id: string; rci_score: number | null; created_at: string }[];
  transactions: { order_code: number; amount: number; status: string; created_at: string }[];
  /** null until migration 011 is applied. */
  ai_30d: { calls: number; total_tokens: number; cost_vnd: number } | null;
};

async function countOf(table: string, userId: string, extra?: (query: any) => any): Promise<number> {
  let query = supabase.from(table).select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function fetchAdminUserDetail(id: string): Promise<AdminUserDetail> {
  const { data: user, error } = await supabase.from("users")
    .select("id,user_code,email,full_name,phone,credits,is_admin,created_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!user) throw new HttpError(404, "Không tìm thấy người dùng.");

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [cvs, analyses, interviews, paid, recent, txs, usage] = await Promise.all([
    countOf("cv_documents", id),
    countOf("analyses", id),
    countOf("interview_sessions", id),
    countOf("transactions", id, (query) => query.eq("status", "SUCCESS")),
    supabase.from("analyses").select("id,rci_score,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("transactions").select("order_code,amount,status,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("ai_usage").select("input_tokens,output_tokens,thought_tokens,total_tokens").eq("user_id", id).gte("created_at", since).limit(5000)
  ]);
  if (recent.error) throw recent.error;
  if (txs.error) throw txs.error;

  let ai: AdminUserDetail["ai_30d"] = null;
  if (!usage.error) {
    const pricing = currentPricing();
    ai = { calls: 0, total_tokens: 0, cost_vnd: 0 };
    for (const row of usage.data ?? []) {
      ai.calls += 1;
      ai.total_tokens += num(row.total_tokens);
      ai.cost_vnd += estimateCostVnd({ input: num(row.input_tokens), output: num(row.output_tokens), thought: num(row.thought_tokens) }, pricing);
    }
  }

  return {
    user: {
      id: user.id,
      user_code: userCodeOf(user),
      email: user.email,
      full_name: user.full_name,
      phone: user.phone ?? "",
      credits: num(user.credits),
      is_admin: Boolean(user.is_admin),
      created_at: user.created_at
    },
    counts: { cvs, analyses, interviews, transactions_success: paid },
    recent_analyses: (recent.data ?? []).map((row) => ({ id: row.id, rci_score: row.rci_score === null ? null : num(row.rci_score), created_at: row.created_at })),
    transactions: (txs.data ?? []).map((row) => ({ order_code: num(row.order_code), amount: num(row.amount), status: row.status, created_at: row.created_at })),
    ai_30d: ai
  };
}

// ---------- Transactions ----------

export type AdminTransactionPage = {
  transactions: { order_code: number; amount: number; status: string; created_at: string; user_email: string | null; user_code: string | null }[];
  total: number;
  page: number;
  page_size: number;
};

export async function listAdminTransactions(status: string | undefined, page: number): Promise<AdminTransactionPage> {
  const from = (page - 1) * ADMIN_TX_PAGE_SIZE;
  let query = supabase.from("transactions").select("order_code,amount,status,created_at,user_id", { count: "exact" });
  if (status) query = query.eq("status", status);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, from + ADMIN_TX_PAGE_SIZE - 1);
  if (error && error.code !== "PGRST103") throw error;
  const rows = data ?? [];
  const people = new Map<string, { id: string; user_code?: string | null; email: string }>();
  const ids = [...new Set(rows.map((row) => row.user_id as string))];
  if (ids.length) {
    const users = await supabase.from("users").select("id,user_code,email").in("id", ids);
    if (users.error) throw users.error;
    for (const row of users.data ?? []) people.set(row.id, row);
  }
  return {
    transactions: rows.map((row) => {
      const person = people.get(row.user_id as string);
      return {
        order_code: num(row.order_code),
        amount: num(row.amount),
        status: String(row.status),
        created_at: row.created_at,
        user_email: person?.email ?? null,
        user_code: person ? userCodeOf(person) : null
      };
    }),
    total: count ?? 0,
    page,
    page_size: ADMIN_TX_PAGE_SIZE
  };
}

// ---------- Job catalog ----------

export type AdminJobStats = {
  active: number;
  inactive: number;
  last_seen_at: string | null;
  by_source: { source: string; active: number }[];
  by_category: { category: string; label: string; active: number }[];
};

export function buildJobStats(rows: { source: string; category: string | null }[], inactive: number, lastSeenAt: string | null): AdminJobStats {
  const bySource = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
    const category = row.category || "other";
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
  const labels = new Map(JOB_CATEGORIES.map((category) => [category.id, category.label]));
  return {
    active: rows.length,
    inactive,
    last_seen_at: lastSeenAt,
    by_source: [...bySource].map(([source, active]) => ({ source, active })).sort((a, b) => b.active - a.active),
    by_category: [...byCategory].map(([category, active]) => ({ category, label: labels.get(category) ?? "Khác", active }))
      .sort((a, b) => b.active - a.active)
  };
}

export async function fetchAdminJobStats(): Promise<AdminJobStats> {
  const rows: { source: string; category: string | null }[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await supabase.from("job_postings").select("source,category").eq("is_active", true)
      .order("id").range(from, from + 999);
    if (error && error.code !== "PGRST103") throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const [inactive, latest] = await Promise.all([
    supabase.from("job_postings").select("id", { count: "exact", head: true }).eq("is_active", false),
    supabase.from("job_postings").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (inactive.error) throw inactive.error;
  if (latest.error) throw latest.error;
  return buildJobStats(rows, inactive.count ?? 0, latest.data?.last_seen_at ?? null);
}
