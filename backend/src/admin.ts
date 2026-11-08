import { z } from "zod";
import { supabase } from "./supabase";

export const MAX_ADMINS = 3;
export const MIGRATION_007 = "007_admin_role.sql";

export function deriveUserCode(id: string): string {
  const clean = id.replace(/[^0-9a-fA-F]/g, "").padEnd(32, "0");
  const head = Number.parseInt(clean.slice(0, 7), 16) || 0;
  const tail = Number.parseInt(clean.slice(25, 32), 16) || 0;
  const seed = head ^ tail;
  return String(10_000_000 + (seed % 90_000_000));
}

const emailSchema = z.string().trim().toLowerCase().email().max(320);

export type AdminCandidate = {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  email_confirmed_at: string | null;
};

export type AdminRuleCheck =
  | { ok: true; normalizedEmail: string; alreadyAdmin: boolean }
  | { ok: false; code: "INVALID_EMAIL" | "USER_NOT_FOUND" | "EMAIL_NOT_CONFIRMED" | "MAX_LIMIT_REACHED"; message: string };

/**
 * Pure validation of the 3 strict admin assignment rules:
 * 1. Valid registered email in `public.users`
 * 2. Confirmed email via OTP (`email_confirmed_at` is non-null in `auth.users`)
 * 3. Active admin count must stay <= MAX_ADMINS (3)
 */
export function validateAdminGrantCandidate(
  rawEmail: string,
  candidate: AdminCandidate | null,
  currentAdminCount: number,
  maxAdmins = MAX_ADMINS
): AdminRuleCheck {
  const parsedEmail = emailSchema.safeParse(rawEmail);
  if (!parsedEmail.success) {
    return { ok: false, code: "INVALID_EMAIL", message: "Địa chỉ email không hợp lệ." };
  }
  const normalizedEmail = parsedEmail.data;
  if (!candidate || candidate.email.trim().toLowerCase() !== normalizedEmail) {
    return {
      ok: false,
      code: "USER_NOT_FOUND",
      message: `Không tìm thấy tài khoản với email ${normalizedEmail} trong hệ thống.`
    };
  }
  if (!candidate.email_confirmed_at) {
    return {
      ok: false,
      code: "EMAIL_NOT_CONFIRMED",
      message: `Tài khoản ${normalizedEmail} chưa xác thực email (OTP) nên không được cấp quyền quản trị.`
    };
  }
  if (candidate.is_admin) {
    return { ok: true, normalizedEmail, alreadyAdmin: true };
  }
  if (currentAdminCount >= maxAdmins) {
    return {
      ok: false,
      code: "MAX_LIMIT_REACHED",
      message: `Hệ thống chỉ cho phép tối đa ${maxAdmins} tài khoản quản trị (hiện đã có ${currentAdminCount}/${maxAdmins}).`
    };
  }
  return { ok: true, normalizedEmail, alreadyAdmin: false };
}

export type AdminUserSummary = {
  id: string;
  user_code: string;
  email: string;
  full_name: string;
  created_at: string;
};

export type AdminUserRow = {
  id: string;
  user_code: string;
  email: string;
  full_name: string;
  credits: number;
  is_admin: boolean;
  created_at: string;
};

export type AdminTransactionItem = {
  order_code: number;
  amount: number;
  status: "PENDING" | "SUCCESS" | "CANCELLED";
  created_at: string;
  user_email: string | null;
};

export type AdminOverview = {
  generated_at: string;
  rules: {
    max_admins: number;
    current_admins: number;
    remaining_slots: number;
  };
  users: {
    total: number;
    admins: number;
    new_last_7d: number;
    total_credits: number;
  };
  cvs: {
    total: number;
    evaluations_total: number;
    avg_quality_score: number | null;
  };
  analyses: {
    total: number;
    avg_rci_score: number | null;
    high_match_count: number;
  };
  interviews: {
    total: number;
    completed: number;
    in_progress: number;
    answers_total: number;
  };
  revenue: {
    total_vnd: number;
    success_count: number;
    pending_count: number;
    cancelled_count: number;
    recent_transactions: AdminTransactionItem[];
  };
  jobs: {
    active_count: number;
    last_seen_at: string | null;
  };
  admins: AdminUserSummary[];
};

/** A report counts as a strong match from this score. */
export const HIGH_MATCH_SCORE = 70;
export const ADMIN_USERS_PAGE_SIZE = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Supabase returns at most 1,000 rows per request by default ("Max rows"), so larger reads go page by page.
const READ_PAGE_SIZE = 1000;
const MAX_READ_PAGES = 500;

/** Exact row counts, taken with count queries so no row limit can cut them short. */
export type OverviewCounts = {
  users: number;
  admins: number;
  newUsers7d: number;
  cvs: number;
  evaluations: number;
  analyses: number;
  highMatch: number;
  interviews: number;
  interviewsCompleted: number;
  interviewsInProgress: number;
  answers: number;
  txSuccess: number;
  txPending: number;
  txCancelled: number;
  activeJobs: number;
};

export type OverviewInput = {
  now?: number;
  counts: OverviewCounts;
  credits: number[];
  qualityScores: number[];
  rciScores: number[];
  successAmounts: number[];
  admins: { id: string; user_code?: string | null; email: string; full_name: string; created_at: string }[];
  recentTransactions: AdminTransactionItem[];
  lastJobSyncAt: string | null;
};

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(sum(values) / values.length);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

/** The stored 8-digit code, or the same code derived from the id for rows saved before migration 007. */
export function userCodeOf(user: { id: string; user_code?: string | null }): string {
  return user.user_code && /^[0-9]{7,8}$/.test(user.user_code) ? user.user_code : deriveUserCode(user.id);
}

export function buildAdminOverview(input: OverviewInput): AdminOverview {
  const { counts } = input;
  return {
    generated_at: new Date(input.now ?? Date.now()).toISOString(),
    rules: {
      max_admins: MAX_ADMINS,
      current_admins: counts.admins,
      remaining_slots: Math.max(0, MAX_ADMINS - counts.admins)
    },
    users: {
      total: counts.users,
      admins: counts.admins,
      new_last_7d: counts.newUsers7d,
      total_credits: sum(input.credits)
    },
    cvs: {
      total: counts.cvs,
      evaluations_total: counts.evaluations,
      avg_quality_score: average(input.qualityScores)
    },
    analyses: {
      total: counts.analyses,
      avg_rci_score: average(input.rciScores),
      high_match_count: counts.highMatch
    },
    interviews: {
      total: counts.interviews,
      completed: counts.interviewsCompleted,
      in_progress: counts.interviewsInProgress,
      answers_total: counts.answers
    },
    revenue: {
      total_vnd: sum(input.successAmounts),
      success_count: counts.txSuccess,
      pending_count: counts.txPending,
      cancelled_count: counts.txCancelled,
      recent_transactions: input.recentTransactions.slice(0, 8)
    },
    jobs: {
      active_count: counts.activeJobs,
      last_seen_at: input.lastJobSyncAt
    },
    admins: input.admins.map(({ id, user_code, email, full_name, created_at }) => ({
      id, user_code: userCodeOf({ id, user_code }), email, full_name, created_at
    }))
  };
}

export function isMissingAdminColumn(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /is_admin/i.test(error.message));
}

type PageResult<T> = { data: T[] | null; error: { code?: string; message?: string } | null };

/**
 * Reads every row, one page at a time. The next page starts after the rows actually received and the
 * read ends on an empty page, so a server row cap smaller than the page size still loses nothing.
 */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = READ_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_READ_PAGES; page++) {
    const { data, error } = await fetchPage(rows.length, rows.length + pageSize - 1);
    // PGRST103: the offset is already past the last row.
    if (error && error.code !== "PGRST103") throw error;
    if (error || !data?.length) return rows;
    rows.push(...data);
  }
  throw new Error(`Dữ liệu vượt ${MAX_READ_PAGES} trang; cần chuyển phép tính sang database.`);
}

async function countRows(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function numericColumn(table: string, column: string, onlyStatus?: string): Promise<number[]> {
  const rows = await readAllPages<Record<string, unknown>>((from, to) => {
    let query = supabase.from(table).select(column);
    if (onlyStatus) query = query.eq("status", onlyStatus);
    return query.order("id").range(from, to) as unknown as PromiseLike<PageResult<Record<string, unknown>>>;
  });
  return rows.map((row) => Number(row[column]) || 0);
}

/** Every figure is exact: counts come from the database, sums and averages read all rows. Any failed read fails the overview. */
export async function fetchAdminOverview(now = Date.now()): Promise<AdminOverview> {
  const head = { count: "exact", head: true } as const;
  const weekAgo = new Date(now - WEEK_MS).toISOString();
  const [
    users, admins, newUsers7d, cvs, evaluations, analyses, highMatch,
    interviews, interviewsCompleted, interviewsInProgress, answers,
    txSuccess, txPending, txCancelled, activeJobs
  ] = await Promise.all([
    countRows(supabase.from("users").select("id", head)),
    countRows(supabase.from("users").select("id", head).eq("is_admin", true)),
    countRows(supabase.from("users").select("id", head).gte("created_at", weekAgo)),
    countRows(supabase.from("cv_documents").select("id", head)),
    countRows(supabase.from("cv_evaluations").select("id", head)),
    countRows(supabase.from("analyses").select("id", head)),
    countRows(supabase.from("analyses").select("id", head).gte("rci_score", HIGH_MATCH_SCORE)),
    countRows(supabase.from("interview_sessions").select("id", head)),
    countRows(supabase.from("interview_sessions").select("id", head).eq("status", "COMPLETED")),
    countRows(supabase.from("interview_sessions").select("id", head).eq("status", "IN_PROGRESS")),
    countRows(supabase.from("interview_answers").select("session_id", head)),
    countRows(supabase.from("transactions").select("id", head).eq("status", "SUCCESS")),
    countRows(supabase.from("transactions").select("id", head).eq("status", "PENDING")),
    countRows(supabase.from("transactions").select("id", head).eq("status", "CANCELLED")),
    countRows(supabase.from("job_postings").select("id", head).eq("is_active", true))
  ]);

  const [credits, qualityScores, rciScores, successAmounts, adminRes, txRes, latestJobRes] = await Promise.all([
    numericColumn("users", "credits"),
    numericColumn("cv_evaluations", "quality_score"),
    numericColumn("analyses", "rci_score"),
    numericColumn("transactions", "amount", "SUCCESS"),
    supabase.from("users").select("id,user_code,email,full_name,created_at").eq("is_admin", true).order("created_at"),
    supabase.from("transactions").select("order_code,amount,status,created_at,user_id")
      .order("created_at", { ascending: false }).limit(8),
    supabase.from("job_postings").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (adminRes.error) throw adminRes.error;
  if (txRes.error) throw txRes.error;
  if (latestJobRes.error) throw latestJobRes.error;

  // Only the few users behind the latest transactions are looked up for their email.
  const transactions = (txRes.data ?? []) as {
    order_code: number; amount: number; status: AdminTransactionItem["status"]; created_at: string; user_id: string;
  }[];
  const emailById = new Map<string, string>();
  const userIds = [...new Set(transactions.map((tx) => tx.user_id))];
  if (userIds.length) {
    const { data, error } = await supabase.from("users").select("id,email").in("id", userIds);
    if (error) throw error;
    for (const row of data ?? []) emailById.set(row.id, row.email);
  }

  return buildAdminOverview({
    now,
    counts: {
      users, admins, newUsers7d, cvs, evaluations, analyses, highMatch,
      interviews, interviewsCompleted, interviewsInProgress, answers,
      txSuccess, txPending, txCancelled, activeJobs
    },
    credits,
    qualityScores,
    rciScores,
    successAmounts,
    admins: (adminRes.data ?? []) as OverviewInput["admins"],
    recentTransactions: transactions.map((tx) => ({
      order_code: Number(tx.order_code),
      amount: Number(tx.amount),
      status: tx.status,
      created_at: tx.created_at,
      user_email: emailById.get(tx.user_id) ?? null
    })),
    lastJobSyncAt: latestJobRes.data?.last_seen_at ?? null
  });
}

/** Splits a search into words without the characters that are syntax inside PostgREST's or() filter. */
export function searchWords(query: string | undefined, limit = 5): string[] {
  return (query ?? "").replace(/[%_,()*\\"':]/g, " ").split(/\s+/u).filter(Boolean).slice(0, limit);
}

export type AdminUserPage = { users: AdminUserRow[]; total: number; page: number; page_size: number };

/** Searches all accounts in the database; each word must match the email, the name or the 8-digit ID. */
export async function listAdminUsers(query: string | undefined, page: number): Promise<AdminUserPage> {
  const from = (page - 1) * ADMIN_USERS_PAGE_SIZE;
  let request = supabase.from("users").select("id,user_code,email,full_name,credits,is_admin,created_at", { count: "exact" });
  for (const word of searchWords(query)) {
    request = request.or(`email.ilike.%${word}%,full_name.ilike.%${word}%,user_code.ilike.%${word}%`);
  }
  const { data, error, count } = await request.order("created_at", { ascending: false }).order("id")
    .range(from, from + ADMIN_USERS_PAGE_SIZE - 1);
  // PGRST103: the page is past the last result, which is simply an empty page.
  if (error && error.code !== "PGRST103") throw error;
  return {
    users: (data ?? []).map((row) => ({
      id: row.id,
      user_code: userCodeOf(row),
      email: row.email,
      full_name: row.full_name,
      credits: Number(row.credits) || 0,
      is_admin: Boolean(row.is_admin),
      created_at: row.created_at
    })),
    total: count ?? 0,
    page,
    page_size: ADMIN_USERS_PAGE_SIZE
  };
}
