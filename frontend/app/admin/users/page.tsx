"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatUserCode } from "../../app-frame";
import {
  AdminCard, AdminNotice, AdminPageHeader, EmptyState, fmtDate, fmtDateTime, fmtNumber, fmtVnd, RefreshButton, useAdminData
} from "../admin-ui";
import { TX_STATUS_LABELS, type AdminUserDetail, type AdminUserRow } from "../types";

type UserPage = { users: AdminUserRow[]; total: number; page: number; page_size: number };

export default function AdminUsersPage() {
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("q", query);
  // The list is searched and paged by the server, so every account can be found, not only recent ones.
  const users = useAdminData<UserPage>(`/admin/users?${params}`);
  const lastPage = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.page_size)) : 1;

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(searchDraft.trim());
  }

  return (
    <>
      <AdminPageHeader
        title="Người dùng"
        description="Tìm tài khoản, xem mức độ sử dụng và lịch sử thanh toán của từng người."
        actions={<RefreshButton loading={users.loading} onClick={users.reload} />}
      />

      <AdminCard
        label="Danh sách người dùng"
        title={query ? `Kết quả tìm “${query}”` : "Tất cả người dùng"}
        description={users.data ? `${fmtNumber(users.data.total)} tài khoản` : undefined}
        actions={
          <form className="admin-search" role="search" onSubmit={search}>
            <input
              type="search"
              className="form-input"
              aria-label="Tìm người dùng"
              placeholder="Mã ID 8 số, email hoặc họ tên..."
              maxLength={100}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            <button type="submit" className="secondary-button" disabled={users.loading}>Tìm</button>
          </form>
        }
      >
        {users.error && <AdminNotice>{users.error}</AdminNotice>}
        {users.data && users.data.users.length === 0 && (
          <EmptyState>{query ? `Không tìm thấy người dùng khớp “${query}”.` : "Chưa có người dùng nào."}</EmptyState>
        )}
        {users.data && users.data.users.length > 0 && (
          <div className="admin-table-wrap" aria-busy={users.loading}>
            <table className="admin-table">
              <thead>
                <tr><th>Người dùng</th><th>Mã ID</th><th className="num">Credits</th><th>Vai trò</th><th>Ngày tạo</th><th><span className="visually-hidden">Thao tác</span></th></tr>
              </thead>
              <tbody>
                {users.data.users.map((user) => (
                  <tr key={user.id} className={selected === user.id ? "is-selected" : ""}>
                    <td>
                      <div className="admin-person">
                        <span className="admin-avatar" aria-hidden="true">{(user.full_name || user.email).trim().charAt(0).toUpperCase()}</span>
                        <span><strong>{user.full_name || "Chưa đặt tên"}</strong><small>{user.email}</small></span>
                      </div>
                    </td>
                    <td><code className="admin-code">{user.user_code || formatUserCode(user.id)}</code></td>
                    <td className="num">{fmtNumber(user.credits)}</td>
                    <td><span className={`admin-badge ${user.is_admin ? "admin-badge-success" : "admin-badge-neutral"}`}>{user.is_admin ? "Admin" : "Người dùng"}</span></td>
                    <td>{fmtDate(user.created_at)}</td>
                    <td className="admin-row-action">
                      <button type="button" className="text-button" onClick={() => setSelected(user.id)} aria-label={`Xem chi tiết ${user.email}`}>Chi tiết →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {users.data && lastPage > 1 && (
          <nav className="admin-pager" aria-label="Phân trang người dùng">
            <button type="button" className="secondary-button" disabled={page <= 1 || users.loading} onClick={() => setPage(page - 1)}>← Trước</button>
            <span>Trang {page}/{lastPage}</span>
            <button type="button" className="secondary-button" disabled={page >= lastPage || users.loading} onClick={() => setPage(page + 1)}>Sau →</button>
          </nav>
        )}
      </AdminCard>

      {selected && <UserDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = useAdminData<{ detail: AdminUserDetail }>(`/admin/users/${id}`);
  const detail = data?.detail;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="admin-drawer-backdrop" onClick={onClose}>
      <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label="Chi tiết người dùng" onClick={(event) => event.stopPropagation()}>
        <div className="admin-drawer-head">
          <h2>Chi tiết người dùng</h2>
          <button type="button" className="chat-close" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        {loading && !detail && <p className="muted-copy">Đang tải...</p>}
        {error && <AdminNotice>{error}</AdminNotice>}
        {detail && (
          <div className="admin-drawer-body">
            <div className="admin-person admin-person-lg">
              <span className="admin-avatar" aria-hidden="true">{(detail.user.full_name || detail.user.email).trim().charAt(0).toUpperCase()}</span>
              <span>
                <strong>{detail.user.full_name || "Chưa đặt tên"}</strong>
                <small>{detail.user.email}{detail.user.phone ? ` · ${detail.user.phone}` : ""}</small>
              </span>
            </div>
            <dl className="admin-stats admin-stats-inline">
              <div><dt>Mã ID</dt><dd><code className="admin-code">{detail.user.user_code}</code></dd></div>
              <div><dt>Vai trò</dt><dd>{detail.user.is_admin ? "Admin" : "Người dùng"}</dd></div>
              <div><dt>Credits</dt><dd>{fmtNumber(detail.user.credits)}</dd></div>
              <div><dt>Tham gia</dt><dd>{fmtDate(detail.user.created_at)}</dd></div>
            </dl>

            <h3>Mức độ sử dụng</h3>
            <div className="admin-mini-kpis">
              <div><strong>{detail.counts.cvs}</strong><span>CV</span></div>
              <div><strong>{detail.counts.analyses}</strong><span>Phân tích</span></div>
              <div><strong>{detail.counts.interviews}</strong><span>Phỏng vấn</span></div>
              <div><strong>{detail.counts.transactions_success}</strong><span>Thanh toán</span></div>
            </div>

            <h3>AI trong 30 ngày</h3>
            {detail.ai_30d ? (
              <p className="admin-drawer-line">
                {fmtNumber(detail.ai_30d.calls)} lượt gọi · {fmtNumber(detail.ai_30d.total_tokens)} token · ≈ {fmtVnd(detail.ai_30d.cost_vnd)}
              </p>
            ) : <p className="admin-footnote">Chưa ghi nhận token (cần migration 011).</p>}

            <h3>Phân tích gần đây</h3>
            {detail.recent_analyses.length ? (
              <ul className="admin-simple-list">
                {detail.recent_analyses.map((row) => (
                  <li key={row.id}><span>{fmtDateTime(row.created_at)}</span><b>{row.rci_score !== null ? `${row.rci_score}%` : "—"}</b></li>
                ))}
              </ul>
            ) : <p className="admin-footnote">Chưa có lượt phân tích.</p>}

            <h3>Giao dịch</h3>
            {detail.transactions.length ? (
              <ul className="admin-simple-list">
                {detail.transactions.map((tx) => (
                  <li key={tx.order_code}>
                    <span>#{tx.order_code} · {fmtDateTime(tx.created_at)}</span>
                    <span className={`admin-badge admin-badge-${tx.status.toLowerCase()}`}>{TX_STATUS_LABELS[tx.status]}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="admin-footnote">Chưa có giao dịch.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
