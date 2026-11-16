"use client";

import { useCallback, useEffect, useState } from "react";
import { CV_TEMPLATES } from "./cv-editor";

/**
 * Plans, quotas and the user's subscription.
 *
 * DEMO: there is no subscription backend yet, so the subscription and its usage live in this browser
 * (localStorage, per user) and checkout can simulate a successful payment. Everything that reads or
 * changes a subscription goes through `usePlan`, so connecting the real API later only changes this file.
 */
export const DEMO_BILLING = true;

export type PlanId = "free" | "pro_month" | "pro_quarter";
export type QuotaKey = "analyses" | "interviews" | "photos";

export type Plan = {
  id: PlanId;
  name: string;
  price: number;
  /** Days of Pro a purchase adds; 0 for Free. */
  days: number;
  tagline: string;
  quotas: Record<QuotaKey, number>;
  highlight?: string;
};

export const QUOTA_LABELS: Record<QuotaKey, string> = {
  analyses: "Phân tích CV–JD",
  interviews: "Phỏng vấn AI",
  photos: "Ảnh CV AI"
};

/** Phrases after a number ("30 lượt phân tích CV–JD"); kept apart so acronyms keep their case. */
export const QUOTA_UNITS: Record<QuotaKey, string> = {
  analyses: "lượt phân tích CV–JD",
  interviews: "buổi phỏng vấn AI",
  photos: "ảnh CV bằng AI"
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Miễn phí",
    price: 0,
    days: 0,
    tagline: "Dùng thử các tính năng chính",
    quotas: { analyses: 3, interviews: 1, photos: 1 }
  },
  pro_month: {
    id: "pro_month",
    name: "Pro 1 tháng",
    price: 29000,
    days: 30,
    tagline: "Cho đợt ứng tuyển đang gấp",
    quotas: { analyses: 30, interviews: 10, photos: 10 },
    highlight: "Phổ biến nhất"
  },
  pro_quarter: {
    id: "pro_quarter",
    name: "Pro 3 tháng",
    price: 59000,
    days: 90,
    tagline: "Cả mùa tuyển dụng, tiết kiệm hơn",
    quotas: { analyses: 100, interviews: 30, photos: 30 }
  }
};

export const PAID_PLANS = [PLANS.pro_month, PLANS.pro_quarter];

/** "Tiết kiệm 32%" for a plan cheaper than buying the same days month by month; null otherwise. */
export function savingLabel(plan: Plan): string | null {
  const monthly = PLANS.pro_month;
  if (plan.id === monthly.id || plan.days === 0) return null;
  const percent = Math.round((1 - plan.price / (monthly.price * (plan.days / monthly.days))) * 100);
  return percent > 0 ? `Tiết kiệm ${percent}%` : null;
}

/** What every plan includes, for the comparison table. `true` = included, a string = the limit. */
export const FEATURE_ROWS: { label: string; free: string | boolean; pro: string | boolean }[] = [
  { label: "Kho việc làm & lưu tin", free: true, pro: true },
  { label: `Tạo CV từ ${CV_TEMPLATES.length} mẫu`, free: true, pro: true },
  { label: "Chấm chất lượng CV & trợ lý chat", free: true, pro: true },
  { label: "Phân tích CV–JD bằng AI", free: "3 lượt/tháng", pro: "30–100 lượt" },
  { label: "Phỏng vấn thử với AI (giọng nói)", free: "1 buổi", pro: "10–30 buổi" },
  { label: "Ảnh CV chuyên nghiệp bằng AI", free: "1 ảnh dùng thử", pro: "10–30 ảnh" },
  { label: "Hỗ trợ ưu tiên qua chat", free: false, pro: true }
];

export const fmtPrice = (value: number) => value === 0 ? "0đ" : `${value.toLocaleString("vi-VN")}đ`;

type Subscription = {
  plan: PlanId;
  /** ISO time Pro ends; null on Free. */
  expiresAt: string | null;
  /** Usage in the current period. */
  used: Record<QuotaKey, number>;
  /** Start of the current usage period (Free resets monthly, Pro at each purchase). */
  periodStart: string;
};

export type DemoOrder = { code: number; plan: PlanId; amount: number; createdAt: string; paidAt?: string };

const FREE_SUBSCRIPTION = (): Subscription => ({
  plan: "free",
  expiresAt: null,
  used: { analyses: 0, interviews: 0, photos: 0 },
  periodStart: new Date().toISOString()
});

const storageKey = (userId: string) => `jr-subscription-${userId}`;
const ordersKey = (userId: string) => `jr-orders-${userId}`;
const CHANGE_EVENT = "jr-subscription-change";

function read(userId: string): Subscription {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "null") as Subscription | null;
    if (!saved) return FREE_SUBSCRIPTION();
    // Expired Pro falls back to Free with fresh usage.
    if (saved.plan !== "free" && saved.expiresAt && new Date(saved.expiresAt).getTime() < Date.now()) return FREE_SUBSCRIPTION();
    // Free usage resets every 30 days.
    if (saved.plan === "free" && Date.now() - new Date(saved.periodStart).getTime() > 30 * 86_400_000) return FREE_SUBSCRIPTION();
    return saved;
  } catch {
    return FREE_SUBSCRIPTION();
  }
}

function write(userId: string, subscription: Subscription) {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(subscription));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readOrders(userId: string): DemoOrder[] {
  try {
    return JSON.parse(window.localStorage.getItem(ordersKey(userId)) ?? "[]") as DemoOrder[];
  } catch {
    return [];
  }
}

export function saveOrder(userId: string, order: DemoOrder) {
  const orders = readOrders(userId).filter((item) => item.code !== order.code);
  window.localStorage.setItem(ordersKey(userId), JSON.stringify([order, ...orders].slice(0, 20)));
}

/** The signed-in user's subscription; every open component updates when it changes. */
export function usePlan(userId: string | undefined) {
  const [subscription, setSubscription] = useState<Subscription>(FREE_SUBSCRIPTION);

  useEffect(() => {
    if (!userId) return;
    const sync = () => setSubscription(read(userId));
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [userId]);

  const plan = PLANS[subscription.plan];
  const isPro = subscription.plan !== "free";
  const remaining = (key: QuotaKey) => Math.max(0, plan.quotas[key] - subscription.used[key]);

  /** Adds a paid plan's days; buying again while Pro extends the end date. */
  const activate = useCallback((planId: PlanId) => {
    if (!userId) return;
    const current = read(userId);
    const bought = PLANS[planId];
    const from = current.plan !== "free" && current.expiresAt ? Math.max(Date.now(), new Date(current.expiresAt).getTime()) : Date.now();
    write(userId, {
      plan: planId,
      expiresAt: new Date(from + bought.days * 86_400_000).toISOString(),
      used: { analyses: 0, interviews: 0, photos: 0 },
      periodStart: new Date().toISOString()
    });
  }, [userId]);

  /** Uses one unit of a quota; false when none is left. */
  const consume = useCallback((key: QuotaKey) => {
    if (!userId) return false;
    const current = read(userId);
    if (current.used[key] >= PLANS[current.plan].quotas[key]) return false;
    write(userId, { ...current, used: { ...current.used, [key]: current.used[key] + 1 } });
    return true;
  }, [userId]);

  const cancelDemo = useCallback(() => {
    if (userId) write(userId, FREE_SUBSCRIPTION());
  }, [userId]);

  return { subscription, plan, isPro, remaining, activate, consume, cancelDemo };
}

export function daysLeft(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}
