"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "../app-frame";
import { daysLeft, DEMO_BILLING, fmtPrice, PLANS, QUOTA_LABELS, readOrders, usePlan, type DemoOrder, type QuotaKey } from "../plans";

/** The user's plan, what is left of each quota, and their recent orders. */
export function PlanCard() {
  const { session } = useApp();
  const userId = session.user.id;
  const { subscription, plan, isPro, remaining, cancelDemo } = usePlan(userId);
  const [orders, setOrders] = useState<DemoOrder[]>([]);

  useEffect(() => {
    setOrders(readOrders(userId).filter((order) => order.paidAt));
  }, [userId, subscription]);

  const left = daysLeft(subscription.expiresAt);

  return (
    <section className="soft-card input-card plan-status" aria-label="Gói & hạn mức">
      <div className="plan-status-head">
        <div>
          <span className={`plan-status-badge${isPro ? " is-pro" : ""}`}>{isPro ? "PRO" : "MIỄN PHÍ"}</span>
          <h2>{plan.name}</h2>
          <p>
            {isPro
              ? `Hết hạn ngày ${new Date(subscription.expiresAt!).toLocaleDateString("vi-VN")} · còn ${left} ngày`
              : "Lượt miễn phí được làm mới mỗi 30 ngày"}
          </p>
        </div>
        <Link href="/pricing" className={`${isPro ? "secondary-button" : "primary-button"} link-button plan-status-cta`}>
          {isPro ? "Gia hạn" : "✦ Nâng cấp Pro"}
        </Link>
      </div>

      {isPro && left <= 5 && <p className="plan-status-warn" role="status">Gói Pro sắp hết hạn — gia hạn để không bị gián đoạn.</p>}

      <ul className="plan-usage">
        {(Object.keys(QUOTA_LABELS) as QuotaKey[]).map((key) => {
          const total = plan.quotas[key];
          const used = total - remaining(key);
          return (
            <li key={key}>
              <div><span>{QUOTA_LABELS[key]}</span><b>{used}/{total}</b></div>
              <span className="plan-usage-track" aria-hidden="true">
                <span className={used >= total ? "is-full" : ""} style={{ width: `${total ? (used / total) * 100 : 0}%` }} />
              </span>
            </li>
          );
        })}
      </ul>

      {orders.length > 0 && (
        <details className="plan-orders">
          <summary>Lịch sử thanh toán ({orders.length})</summary>
          <ul>
            {orders.map((order) => (
              <li key={order.code}>
                <span>#{order.code} · {PLANS[order.plan].name}</span>
                <span>{fmtPrice(order.amount)} · {new Date(order.paidAt!).toLocaleDateString("vi-VN")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {DEMO_BILLING && isPro && (
        <button type="button" className="text-button plan-reset" onClick={cancelDemo}>Chế độ demo: trả về gói miễn phí</button>
      )}
    </section>
  );
}
