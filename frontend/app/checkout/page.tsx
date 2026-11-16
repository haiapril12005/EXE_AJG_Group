"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useApp } from "../app-frame";
import { daysLeft, DEMO_BILLING, fmtPrice, PAID_PLANS, PLANS, QUOTA_UNITS, saveOrder, savingLabel, usePlan, type PlanId, type QuotaKey } from "../plans";

const PAYMENT_WINDOW_S = 15 * 60;

type Stage = "review" | "paying" | "success" | "expired";

export default function CheckoutPage() {
  const { session } = useApp();
  const userId = session.user.id;
  const { activate, subscription } = usePlan(userId);
  const [planId, setPlanId] = useState<PlanId>("pro_month");
  const [stage, setStage] = useState<Stage>("review");
  const [order, setOrder] = useState<{ code: number; qr: string; createdAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const plan = PLANS[planId];

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("plan");
    if (requested === "pro_month" || requested === "pro_quarter") setPlanId(requested);
  }, []);

  useEffect(() => {
    if (stage !== "paying") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const secondsLeft = order ? Math.max(0, PAYMENT_WINDOW_S - Math.floor((now - order.createdAt) / 1000)) : PAYMENT_WINDOW_S;
  useEffect(() => {
    if (stage === "paying" && secondsLeft === 0) setStage("expired");
  }, [stage, secondsLeft]);

  async function createOrder() {
    const code = Number(String(Date.now()).slice(-9));
    // DEMO: the real QR comes from PayOS (POST /payment/create-qr); this one only carries the order details.
    const qr = await QRCode.toDataURL(`JOBREADY ${code} ${plan.price}`, { width: 260, margin: 1 });
    setOrder({ code, qr, createdAt: Date.now() });
    setNow(Date.now());
    saveOrder(userId, { code, plan: planId, amount: plan.price, createdAt: new Date().toISOString() });
    setStage("paying");
  }

  function simulatePaid() {
    if (!order) return;
    activate(planId);
    saveOrder(userId, { code: order.code, plan: planId, amount: plan.price, createdAt: new Date(order.createdAt).toISOString(), paidAt: new Date().toISOString() });
    setStage("success");
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const steps = ["Chọn gói", "Thanh toán", "Kích hoạt"];
  const stepIndex = stage === "review" ? 0 : stage === "success" ? 2 : 1;

  return (
    <>
      <div className="checkout-top">
        <Link href="/pricing" className="inline-link">← Bảng giá</Link>
        <ol className="checkout-steps" aria-label="Các bước thanh toán">
          {steps.map((label, index) => (
            <li key={label} className={index < stepIndex ? "is-done" : index === stepIndex ? "is-current" : ""} aria-current={index === stepIndex ? "step" : undefined}>
              <span>{index < stepIndex ? "✓" : index + 1}</span>{label}
            </li>
          ))}
        </ol>
      </div>

      {DEMO_BILLING && (
        <p className="checkout-demo" role="note">
          <b>Chế độ demo</b> — chưa kết nối cổng thanh toán thật, không có khoản tiền nào bị trừ.
        </p>
      )}

      <div className="checkout-layout">
        <section className="soft-card checkout-main" aria-label="Thanh toán">
          {stage === "review" && (
            <>
              <h1>Chọn gói Pro</h1>
              <div className="checkout-options" role="radiogroup" aria-label="Gói">
                {PAID_PLANS.map((item) => (
                  <label key={item.id} className={`checkout-option${planId === item.id ? " is-selected" : ""}`}>
                    <input type="radio" name="plan" value={item.id} checked={planId === item.id} onChange={() => setPlanId(item.id)} />
                    <span className="checkout-option-body">
                      <strong>{item.name}{savingLabel(item) && <em>{savingLabel(item)}</em>}</strong>
                      <small>{item.quotas.analyses} phân tích · {item.quotas.interviews} phỏng vấn · {item.quotas.photos} ảnh AI</small>
                    </span>
                    <b>{fmtPrice(item.price)}</b>
                  </label>
                ))}
              </div>
              <h2 className="checkout-subtitle">Phương thức thanh toán</h2>
              <div className="checkout-method">
                <span className="checkout-method-icon" aria-hidden="true">QR</span>
                <span><strong>Chuyển khoản QR (VietQR)</strong><small>Mọi ứng dụng ngân hàng · xác nhận tự động qua PayOS</small></span>
                <span className="checkout-check" aria-hidden="true">✓</span>
              </div>
              <button type="button" className="primary-button checkout-pay" onClick={() => void createOrder()}>
                Thanh toán {fmtPrice(plan.price)}
              </button>
              <p className="checkout-fine">Bằng việc thanh toán, bạn đồng ý với Điều khoản sử dụng và Chính sách hoàn tiền của Job Ready.</p>
            </>
          )}

          {stage === "paying" && order && (
            <div className="checkout-qr-stage">
              <div className="checkout-qr-box">
                <img src={order.qr} alt={`Mã QR thanh toán đơn #${order.code}`} />
                <span className={`checkout-timer${secondsLeft < 120 ? " is-low" : ""}`}>Mã hết hạn sau {mm}:{ss}</span>
              </div>
              <div className="checkout-qr-info">
                <h1>Quét mã để thanh toán</h1>
                <ol className="checkout-howto">
                  <li>Mở ứng dụng ngân hàng, chọn <b>Quét QR</b></li>
                  <li>Quét mã bên cạnh, giữ nguyên số tiền và nội dung</li>
                  <li>Xác nhận — gói Pro kích hoạt ngay khi nhận được tiền</li>
                </ol>
                <dl className="checkout-transfer">
                  <div><dt>Số tiền</dt><dd>{fmtPrice(plan.price)}</dd></div>
                  <div><dt>Nội dung</dt><dd><code>JOBREADY {order.code}</code></dd></div>
                  <div><dt>Mã đơn</dt><dd>#{order.code}</dd></div>
                </dl>
                <p className="checkout-waiting" role="status"><span className="checkout-spinner" aria-hidden="true" /> Đang chờ thanh toán...</p>
                <div className="checkout-actions">
                  {DEMO_BILLING && <button type="button" className="primary-button" onClick={simulatePaid}>Mô phỏng thanh toán thành công</button>}
                  <button type="button" className="secondary-button" onClick={() => { setStage("review"); setOrder(null); }}>Đổi gói / Hủy</button>
                </div>
              </div>
            </div>
          )}

          {stage === "expired" && (
            <div className="checkout-result">
              <span className="checkout-result-icon is-warn" aria-hidden="true">!</span>
              <h1>Mã thanh toán đã hết hạn</h1>
              <p>Nếu bạn đã chuyển khoản, gói Pro vẫn sẽ được kích hoạt khi hệ thống nhận được tiền. Nếu chưa, hãy tạo mã mới.</p>
              <button type="button" className="primary-button" onClick={() => void createOrder()}>Tạo mã mới</button>
            </div>
          )}

          {stage === "success" && order && (
            <div className="checkout-result">
              <span className="checkout-result-icon" aria-hidden="true">✓</span>
              <h1>Nâng cấp thành công!</h1>
              <p>Gói <b>{plan.name}</b> đã được kích hoạt, còn <b>{daysLeft(subscription.expiresAt)} ngày</b> sử dụng.</p>
              <dl className="checkout-transfer checkout-receipt">
                <div><dt>Mã đơn</dt><dd>#{order.code}</dd></div>
                <div><dt>Số tiền</dt><dd>{fmtPrice(plan.price)}</dd></div>
                <div><dt>Hết hạn</dt><dd>{subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString("vi-VN") : "—"}</dd></div>
              </dl>
              <div className="checkout-actions">
                <Link href="/analyze" className="primary-button link-button">Bắt đầu phân tích CV</Link>
                <Link href="/photo-studio" className="secondary-button link-button">Tạo ảnh CV bằng AI</Link>
              </div>
            </div>
          )}
        </section>

        <aside className="soft-card checkout-summary" aria-label="Tóm tắt đơn hàng">
          <h2>Đơn hàng</h2>
          <div className="checkout-line"><span>{plan.name}</span><b>{fmtPrice(plan.price)}</b></div>
          <div className="checkout-line is-muted"><span>Thời hạn</span><span>{plan.days} ngày</span></div>
          <ul className="checkout-includes">
            {(Object.keys(QUOTA_UNITS) as QuotaKey[]).map((key) => (
              <li key={key}><span aria-hidden="true">✓</span>{plan.quotas[key]} {QUOTA_UNITS[key]}</li>
            ))}
          </ul>
          <div className="checkout-line checkout-total"><span>Tổng thanh toán</span><b>{fmtPrice(plan.price)}</b></div>
          <p className="checkout-secure"><span aria-hidden="true">🔒</span> Thanh toán an toàn qua PayOS · Không lưu thông tin thẻ</p>
        </aside>
      </div>
    </>
  );
}
