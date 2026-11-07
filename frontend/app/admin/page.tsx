"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../utils/api";
import { formatUserCode, useApp } from "../app-frame";

type AdminUserSummary = {
  id: string;
  user_code?: string;
  email: string;
  full_name: string;
  created_at: string;
};

type AdminUserRow = {
  id: string;
  user_code?: string;
  email: string;
  full_name: string;
  credits: number;
  is_admin: boolean;
  created_at: string;
};

type AdminTransactionItem = {
  order_code: number;
  amount: number;
  status: "PENDING" | "SUCCESS" | "CANCELLED";
  created_at: string;
  user_email: string | null;
};

type AdminOverview = {
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
  recent_users?: AdminUserRow[];
};

const shortDateTime = (value: string) =>
  new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });

const TX_STATUS_LABELS: Record<AdminTransactionItem["status"], string> = {
  SUCCESS: "Thành công",
  PENDING: "Đang chờ",
  CANCELLED: "Đã hủy"
};

export default function AdminPage() {
  const { token } = useApp();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userSearch, setUserSearch] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ overview: AdminOverview }>("/admin/overview", token);
      setOverview(result.overview);
    } catch (err) {
      setOverview(null);
      setError(err instanceof Error ? err.message : "Không thể tải dữ liệu quản trị.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <>
      <section className="page-heading admin-heading">
        <div>
          <p className="eyebrow">BẢNG ĐIỀU KHIỂN QUẢN TRỊ</p>
          <h1>Thống kê tổng quan hệ thống</h1>
          <p>Theo dõi người dùng, hồ sơ CV, lượt phân tích AI, phiên phỏng vấn và doanh thu PayOS.</p>
        </div>
        {overview && (
          <button type="button" className="secondary-button admin-refresh" disabled={loading} onClick={() => void loadOverview()}>
            {loading ? "Đang cập nhật..." : "↻ Làm mới số liệu"}
          </button>
        )}
      </section>

      {error && (
        <section className="soft-card input-card admin-denied">
          <p role="status" className="notice notice-info">{error}</p>
          <p className="muted-copy">
            Quyền quản trị chỉ được cấp qua lệnh CLI với khóa bí mật máy chủ cho tài khoản đã xác thực email (OTP) và giới hạn tối đa 3 tài khoản Admin.
          </p>
          <Link href="/" className="inline-link">← Về trang phân tích</Link>
        </section>
      )}

      {loading && !overview && !error && <p className="muted-copy">Đang tải số liệu quản trị...</p>}

      {overview && (
        <>
          <section className="admin-kpi-grid" aria-label="Chỉ số tổng quan">
            <article className="soft-card admin-kpi-card">
              <span className="eyebrow">NGƯỜI DÙNG</span>
              <strong className="admin-kpi-value">{overview.users.total.toLocaleString("vi-VN")}</strong>
              <p className="admin-kpi-meta">
                +{overview.users.new_last_7d} mới trong 7 ngày · {overview.users.total_credits.toLocaleString("vi-VN")} credits
              </p>
            </article>

            <article className="soft-card admin-kpi-card">
              <span className="eyebrow">HỒ SƠ CV</span>
              <strong className="admin-kpi-value">{overview.cvs.total.toLocaleString("vi-VN")}</strong>
              <p className="admin-kpi-meta">
                {overview.cvs.evaluations_total} lượt chấm chất lượng · TB {overview.cvs.avg_quality_score !== null ? `${overview.cvs.avg_quality_score}/100` : "—"}
              </p>
            </article>

            <article className="soft-card admin-kpi-card">
              <span className="eyebrow">LƯỢT PHÂN TÍCH CV–JD</span>
              <strong className="admin-kpi-value">{overview.analyses.total.toLocaleString("vi-VN")}</strong>
              <p className="admin-kpi-meta">
                Điểm RCI TB: {overview.analyses.avg_rci_score !== null ? `${overview.analyses.avg_rci_score}%` : "—"} · {overview.analyses.high_match_count} lượt ≥ 70%
              </p>
            </article>

            <article className="soft-card admin-kpi-card">
              <span className="eyebrow">PHỎNG VẤN AI</span>
              <strong className="admin-kpi-value">{overview.interviews.total.toLocaleString("vi-VN")}</strong>
              <p className="admin-kpi-meta">
                {overview.interviews.completed} hoàn thành · {overview.interviews.in_progress} đang luyện · {overview.interviews.answers_total} câu trả lời
              </p>
            </article>

            <article className="soft-card admin-kpi-card">
              <span className="eyebrow">DOANH THU PAYOS</span>
              <strong className="admin-kpi-value">{overview.revenue.total_vnd.toLocaleString("vi-VN")}đ</strong>
              <p className="admin-kpi-meta">
                {overview.revenue.success_count} thành công · {overview.revenue.pending_count} đang chờ · {overview.revenue.cancelled_count} đã hủy
              </p>
            </article>

            <article className="soft-card admin-kpi-card">
              <span className="eyebrow">KHO VIỆC LÀM</span>
              <strong className="admin-kpi-value">{overview.jobs.active_count.toLocaleString("vi-VN")}</strong>
              <p className="admin-kpi-meta">
                {overview.jobs.last_seen_at ? `Đồng bộ lúc ${shortDateTime(overview.jobs.last_seen_at)}` : "Chưa đồng bộ việc làm"}
              </p>
            </article>
          </section>

          <div className="history-grid history-grid-wide">
            <section className="soft-card">
              <h3>Giao dịch PayOS gần đây</h3>
              {overview.revenue.recent_transactions.length > 0 ? (
                <div className="admin-list">
                  {overview.revenue.recent_transactions.map((tx) => (
                    <div key={tx.order_code} className="history-item admin-tx-item">
                      <div>
                        <strong>#{tx.order_code} · {tx.amount.toLocaleString("vi-VN")}đ</strong>
                        <small className="admin-subline">{tx.user_email || "Người dùng"} · {shortDateTime(tx.created_at)}</small>
                      </div>
                      <span className={`admin-badge admin-badge-${tx.status.toLowerCase()}`}>
                        {TX_STATUS_LABELS[tx.status]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">Chưa phát sinh giao dịch thanh toán nào.</p>
              )}
            </section>

            <section className="soft-card">
              <h3>Quản trị viên ({overview.rules.current_admins}/{overview.rules.max_admins})</h3>
              <div className="admin-list">
                {overview.admins.map((admin) => {
                  const code = admin.user_code || formatUserCode(admin.id);
                  return (
                    <div key={admin.id} className="history-item">
                      <div>
                        <strong>{admin.full_name || "Quản trị viên"} · <code className="profile-id-code">ID: {code}</code></strong>
                        <small className="admin-subline">{admin.email}</small>
                      </div>
                      <small>{new Date(admin.created_at).toLocaleDateString("vi-VN")}</small>
                    </div>
                  );
                })}
              </div>
              <div className="scoring-breakdown admin-rules-box">
                <strong>Quy tắc bảo mật cấp quyền Admin</strong>
                <p><span>1. Xác thực tài khoản</span><b>Bắt buộc đã xác nhận OTP email</b></p>
                <p><span>2. Giới hạn số lượng</span><b>Tối đa {overview.rules.max_admins} Admin (còn trống {overview.rules.remaining_slots})</b></p>
                <p><span>3. Phương thức cấp quyền</span><b>Chỉ qua CLI/SQL bằng Secret Key</b></p>
                <small>
                  Lệnh gán quyền (theo Email hoặc Mã ID 8 số): <code>npm.cmd run admin:grant -- &lt;email_hoặc_mã_ID&gt;</code> · Thu hồi: <code>npm.cmd run admin:revoke -- &lt;email_hoặc_mã_ID&gt;</code>
                </small>
              </div>
            </section>

            {overview.recent_users && overview.recent_users.length > 0 && (
              <section className="soft-card admin-span-full">
                <div className="admin-users-header">
                  <h3>Danh sách người dùng hệ thống ({overview.users.total})</h3>
                  <input
                    type="search"
                    className="form-input admin-user-search"
                    placeholder="Tìm theo mã ID (8 số), email hoặc họ tên..."
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                  />
                </div>
                <div className="admin-list">
                  {overview.recent_users
                    .filter((user) => {
                      const q = userSearch.trim().toLowerCase();
                      if (!q) return true;
                      const code = user.user_code || formatUserCode(user.id);
                      return (
                        code.includes(q) ||
                        user.email.toLowerCase().includes(q) ||
                        (user.full_name || "").toLowerCase().includes(q)
                      );
                    })
                    .map((user) => {
                      const code = user.user_code || formatUserCode(user.id);
                      return (
                        <div key={user.id} className="history-item admin-tx-item">
                          <div>
                            <strong>
                              <code className="profile-id-code">ID: {code}</code> · {user.full_name || "Chưa đặt tên"} · <span className="muted-copy">{user.email}</span>
                            </strong>
                            <small className="admin-subline">
                              Credits: {user.credits} · Tạo ngày {new Date(user.created_at).toLocaleDateString("vi-VN")}
                            </small>
                          </div>
                          <span className={`admin-badge ${user.is_admin ? "admin-badge-success" : "admin-badge-neutral"}`}>
                            {user.is_admin ? "ADMIN" : "USER"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}

