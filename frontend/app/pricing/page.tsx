"use client";

import Link from "next/link";
import { useApp } from "../app-frame";
import { CV_TEMPLATES } from "../cv-editor";
import { daysLeft, FEATURE_ROWS, fmtPrice, PAID_PLANS, PLANS, QUOTA_UNITS, savingLabel, usePlan, type Plan, type QuotaKey } from "../plans";

const FAQ = [
  {
    q: "Thanh toán bằng cách nào?",
    a: "Quét mã QR bằng ứng dụng ngân hàng bất kỳ (VietQR qua PayOS). Gói Pro được kích hoạt ngay khi hệ thống nhận được tiền, thường trong vài giây."
  },
  {
    q: "Gói Pro có tự gia hạn không?",
    a: "Không. Mỗi lần thanh toán là một kỳ 30 hoặc 90 ngày; gần hết hạn chúng tôi sẽ nhắc bạn. Mua thêm khi đang dùng Pro sẽ cộng dồn số ngày."
  },
  {
    q: "Hết lượt trong kỳ thì sao?",
    a: "Các tính năng không dùng AI (kho việc làm, tạo và sửa CV) vẫn dùng bình thường. Lượt AI được làm mới khi bạn gia hạn."
  },
  {
    q: "Tôi có được hoàn tiền không?",
    a: "Nếu bạn chưa dùng lượt AI nào trong 3 ngày đầu, hãy nhắn hỗ trợ để được hoàn tiền 100%."
  }
];

export default function PricingPage() {
  const { session } = useApp();
  const { subscription, isPro, plan } = usePlan(session.user.id);

  return (
    <>
      <section className="hero pricing-hero">
        <p className="eyebrow">BẢNG GIÁ</p>
        <h1>Đầu tư nhỏ cho <span>công việc mơ ước</span></h1>
        <p>Phân tích CV với từng JD, luyện phỏng vấn bằng giọng nói và có ảnh CV chuyên nghiệp — tất cả trong một gói.</p>
      </section>

      {isPro && (
        <p role="status" className="pricing-current">
          Bạn đang dùng <strong>{plan.name}</strong> · còn {daysLeft(subscription.expiresAt)} ngày. Mua thêm sẽ được cộng dồn thời hạn.
        </p>
      )}

      <section className="pricing-grid" aria-label="Các gói">
        <PlanCard plan={PLANS.free} current={!isPro} />
        {PAID_PLANS.map((item) => <PlanCard key={item.id} plan={item} current={subscription.plan === item.id} />)}
      </section>

      <section className="soft-card pricing-compare" aria-label="So sánh tính năng">
        <h2>So sánh chi tiết</h2>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead><tr><th>Tính năng</th><th>Miễn phí</th><th className="is-pro">Pro</th></tr></thead>
            <tbody>
              {FEATURE_ROWS.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td><Cell value={row.free} /></td>
                  <td className="is-pro"><Cell value={row.pro} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pricing-faq" aria-label="Câu hỏi thường gặp">
        <h2>Câu hỏi thường gặp</h2>
        {FAQ.map((item) => (
          <details key={item.q} className="soft-card">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>
    </>
  );
}

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <span className="pricing-yes" aria-label="Có">✓</span>;
  if (value === false) return <span className="pricing-no" aria-label="Không">—</span>;
  return <span>{value}</span>;
}

function PlanCard({ plan, current }: { plan: Plan; current: boolean }) {
  const paid = plan.price > 0;
  const perMonth = paid ? Math.round(plan.price / (plan.days / 30) / 1000) * 1000 : 0;
  const saving = savingLabel(plan);
  return (
    <article className={`soft-card plan-card${plan.highlight ? " is-featured" : ""}`}>
      {plan.highlight && <span className="plan-ribbon">{plan.highlight}</span>}
      <div className="plan-head">
        <h2>{plan.name}</h2>
        <p>{plan.tagline}</p>
      </div>
      <div className="plan-price">
        <strong>{fmtPrice(plan.price)}</strong>
        {paid && <span>/ {plan.days} ngày</span>}
      </div>
      <p className="plan-sub">
        {paid ? <>≈ {fmtPrice(perMonth)}/tháng{saving && <b> · {saving}</b>}</> : "Không cần thẻ, không giới hạn thời gian"}
      </p>
      <ul className="plan-quotas">
        {(Object.keys(QUOTA_UNITS) as QuotaKey[]).map((key) => (
          <li key={key}><span aria-hidden="true">✓</span><span className="plan-quota-text"><b>{plan.quotas[key]}</b> {QUOTA_UNITS[key]}{!paid ? " / 30 ngày" : ""}</span></li>
        ))}
        <li><span aria-hidden="true">✓</span>Kho việc làm, {CV_TEMPLATES.length} mẫu CV, trợ lý chat</li>
      </ul>
      {paid ? (
        <Link href={`/checkout?plan=${plan.id}`} className={`${plan.highlight ? "primary-button" : "secondary-button"} link-button plan-cta`}>
          {current ? "Gia hạn" : "Nâng cấp"} {plan.name}
        </Link>
      ) : (
        <span className={`plan-cta plan-cta-static${current ? " is-current" : ""}`}>{current ? "Gói hiện tại" : "Gói cơ bản"}</span>
      )}
    </article>
  );
}
