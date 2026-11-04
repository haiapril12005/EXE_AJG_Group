"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { api } from "../utils/api";
import { useApp } from "./app-frame";

type Unlocked = { layer_4_mock: string[]; credits_remaining: number | null };
type Payment = { order_code: number; checkoutUrl: string; qrImage: string | null };

/** PayOS checkout. After payment it unlocks `lockedAnalysisId`, or only adds credits when that is null. */
export function useBilling(lockedAnalysisId: string | null, onUnlocked: (result: Unlocked) => void) {
  const { token, profile, refreshProfile } = useApp();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const latest = useRef({ token, lockedAnalysisId, onUnlocked, refreshProfile });
  useEffect(() => {
    latest.current = { token, lockedAnalysisId, onUnlocked, refreshProfile };
  });

  useEffect(() => {
    if (!payment) return;
    let active = true;
    let unlocking = false;
    const poll = async () => {
      const { token, lockedAnalysisId, onUnlocked, refreshProfile } = latest.current;
      try {
        const result = await api<{ transaction: { status: string } }>(`/payment/${payment.order_code}`, token);
        if (!active || unlocking) return;
        if (result.transaction.status === "SUCCESS") {
          if (!lockedAnalysisId) {
            setPayment(null);
            setStatus("Đã cộng 3 lượt phân tích vào tài khoản.");
            await refreshProfile();
            return;
          }
          unlocking = true;
          setStatus("Thanh toán thành công! Đang cập nhật lượt phân tích...");
          try {
            const unlocked = await api<Unlocked>(`/analyses/${lockedAnalysisId}/unlock`, token,
              { method: "POST", body: JSON.stringify({}) });
            if (!active) return;
            onUnlocked(unlocked);
            setStatus("Mock Interview đã được mở khóa.");
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Không thể mở khóa Mock Interview.");
          }
          setPayment(null);
          await refreshProfile();
        } else if (result.transaction.status === "CANCELLED") {
          setStatus("Giao dịch đã bị hủy.");
          setPayment(null);
        }
      } catch {
        if (active) setStatus("Đang chờ xác nhận thanh toán...");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [payment]);

  async function createPayment() {
    setCreating(true);
    setStatus("");
    try {
      const result = await api<{ order_code: number; checkoutUrl: string; qrCode?: string | null }>(
        "/payment/create-qr", token, { method: "POST", body: JSON.stringify({ package: "premium_29k" }) }
      );
      const qrImage = result.qrCode ? await QRCode.toDataURL(result.qrCode, { width: 240, margin: 1 }) : null;
      setPayment({ order_code: result.order_code, checkoutUrl: result.checkoutUrl, qrImage });
      setStatus("Quét mã QR hoặc mở trang thanh toán. Hệ thống tự kiểm tra trạng thái mỗi 3 giây.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể tạo mã thanh toán.");
    } finally {
      setCreating(false);
    }
  }

  const paying = creating || !!payment;
  const panel = <>
    {profile?.payments_enabled && profile.credits === 0 && <p className="no-print">Bạn đã dùng hết lượt phân tích. <button type="button"
      className="secondary-button" disabled={paying} onClick={() => void createPayment()}>
      Mua thêm 3 lượt · 29.000đ</button></p>}
    {status && <p role="status" className="payment-status no-print">{status}</p>}
    {payment && <div className="payment-panel no-print">
      {payment.qrImage && <img src={payment.qrImage} alt="Mã QR thanh toán PayOS" className="payment-qr" />}
      <div><strong>Đơn hàng #{payment.order_code}</strong><p>Quét mã bằng ứng dụng ngân hàng hoặc mở trang thanh toán PayOS.</p>
        <a href={payment.checkoutUrl} target="_blank" rel="noreferrer">Mở trang thanh toán ↗</a></div>
    </div>}
  </>;

  return { createPayment, paying, panel };
}
