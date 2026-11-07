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
  recent_users: AdminUserRow[];
};

type RawOverviewInput = {
  now?: number;
  users: { id: string; user_code?: string | null; email: string; full_name: string; credits: number; is_admin?: boolean; created_at: string }[];
  cvCount: number;
  evaluations: { quality_score: number }[];
  analyses: { rci_score: number }[];
  interviews: { status: string }[];
  answerCount: number;
  transactions: {
    order_code: number;
    amount: number;
    status: "PENDING" | "SUCCESS" | "CANCELLED";
    created_at: string;
    user_email?: string | null;
  }[];
  activeJobCount: number;
  lastJobSyncAt: string | null;
};

function average(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((acc, item) => acc + item, 0);
  return Math.round(sum / values.length);
}

export function buildAdminOverview(input: RawOverviewInput): AdminOverview {
  const now = input.now ?? Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const admins = input.users
    .filter((user) => Boolean(user.is_admin))
    .map(({ id, user_code, email, full_name, created_at }) => ({
      id,
      user_code: user_code && /^[0-9]{7,8}$/.test(user_code) ? user_code : deriveUserCode(id),
      email,
      full_name,
      created_at
    }));

  const newLast7d = input.users.filter((user) => {
    const created = Date.parse(user.created_at);
    return !Number.isNaN(created) && created >= sevenDaysAgo;
  }).length;

  const totalCredits = input.users.reduce((sum, user) => sum + (Number(user.credits) || 0), 0);

  const successTx = input.transactions.filter((tx) => tx.status === "SUCCESS");
  const pendingTx = input.transactions.filter((tx) => tx.status === "PENDING");
  const cancelledTx = input.transactions.filter((tx) => tx.status === "CANCELLED");
  const totalVnd = successTx.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

  const completedInterviews = input.interviews.filter((session) => session.status === "COMPLETED").length;
  const inProgressInterviews = input.interviews.filter((session) => session.status === "IN_PROGRESS").length;

  return {
    generated_at: new Date(now).toISOString(),
    rules: {
      max_admins: MAX_ADMINS,
      current_admins: admins.length,
      remaining_slots: Math.max(0, MAX_ADMINS - admins.length)
    },
    users: {
      total: input.users.length,
      admins: admins.length,
      new_last_7d: newLast7d,
      total_credits: totalCredits
    },
    cvs: {
      total: input.cvCount,
      evaluations_total: input.evaluations.length,
      avg_quality_score: average(input.evaluations.map((item) => item.quality_score))
    },
    analyses: {
      total: input.analyses.length,
      avg_rci_score: average(input.analyses.map((item) => item.rci_score)),
      high_match_count: input.analyses.filter((item) => item.rci_score >= 70).length
    },
    interviews: {
      total: input.interviews.length,
      completed: completedInterviews,
      in_progress: inProgressInterviews,
      answers_total: input.answerCount
    },
    revenue: {
      total_vnd: totalVnd,
      success_count: successTx.length,
      pending_count: pendingTx.length,
      cancelled_count: cancelledTx.length,
      recent_transactions: input.transactions.slice(0, 8).map((tx) => ({
        order_code: Number(tx.order_code),
        amount: Number(tx.amount),
        status: tx.status,
        created_at: tx.created_at,
        user_email: tx.user_email ?? null
      }))
    },
    jobs: {
      active_count: input.activeJobCount,
      last_seen_at: input.lastJobSyncAt
    },
    admins,
    recent_users: input.users.slice(0, 50).map((user) => ({
      id: user.id,
      user_code: user.user_code && /^[0-9]{7,8}$/.test(user.user_code) ? user.user_code : deriveUserCode(user.id),
      email: user.email,
      full_name: user.full_name,
      credits: Number(user.credits) || 0,
      is_admin: Boolean(user.is_admin),
      created_at: user.created_at
    }))
  };
}

export function isMissingAdminColumn(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /is_admin/i.test(error.message));
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const [
    usersWithCodeRes,
    cvCountRes,
    evalsRes,
    analysesRes,
    interviewsRes,
    answersCountRes,
    txRes,
    jobsCountRes,
    latestJobRes
  ] = await Promise.all([
    supabase.from("users").select("id,user_code,email,full_name,credits,is_admin,created_at").order("created_at", { ascending: false }),
    supabase.from("cv_documents").select("id", { count: "exact", head: true }),
    supabase.from("cv_evaluations").select("quality_score"),
    supabase.from("analyses").select("rci_score"),
    supabase.from("interview_sessions").select("status"),
    supabase.from("interview_answers").select("session_id", { count: "exact", head: true }),
    supabase.from("transactions").select("order_code,amount,status,created_at,user_id").order("created_at", { ascending: false }),
    supabase.from("job_postings").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("job_postings").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle()
  ]);

  let usersRes = usersWithCodeRes;
  if (usersRes.error && /user_code/i.test(usersRes.error.message)) {
    const fallbackUsers = await supabase
      .from("users")
      .select("id,email,full_name,credits,is_admin,created_at")
      .order("created_at", { ascending: false });
    usersRes = fallbackUsers as typeof usersWithCodeRes;
  }

  if (usersRes.error) throw usersRes.error;
  if (cvCountRes.error) throw cvCountRes.error;
  if (analysesRes.error) throw analysesRes.error;
  if (txRes.error) throw txRes.error;

  const users = (usersRes.data ?? []) as RawOverviewInput["users"];
  const emailByUserId = new Map(users.map((user) => [user.id, user.email]));

  const transactions = ((txRes.data ?? []) as {
    order_code: number;
    amount: number;
    status: "PENDING" | "SUCCESS" | "CANCELLED";
    created_at: string;
    user_id: string;
  }[]).map((tx) => ({
    order_code: tx.order_code,
    amount: tx.amount,
    status: tx.status,
    created_at: tx.created_at,
    user_email: emailByUserId.get(tx.user_id) ?? null
  }));

  return buildAdminOverview({
    users,
    cvCount: cvCountRes.count ?? 0,
    evaluations: (evalsRes.error ? [] : evalsRes.data ?? []) as { quality_score: number }[],
    analyses: (analysesRes.data ?? []) as { rci_score: number }[],
    interviews: (interviewsRes.error ? [] : interviewsRes.data ?? []) as { status: string }[],
    answerCount: answersCountRes.error ? 0 : (answersCountRes.count ?? 0),
    transactions,
    activeJobCount: jobsCountRes.error ? 0 : (jobsCountRes.count ?? 0),
    lastJobSyncAt: latestJobRes.error ? null : (latestJobRes.data?.last_seen_at ?? null)
  });
}

