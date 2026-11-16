"use client";

import { useState } from "react";
import {
  AdminCard, AdminNotice, AdminPageHeader, EmptyState, fmtDateTime, fmtNumber, fmtVnd, KpiCard, RefreshButton, useAdminData
} from "../admin-ui";
import { TX_STATUS_LABELS, type AdminOverview, type AdminTransactionPage, type TxStatus } from "../types";

const FILTERS: { value: TxStatus | ""; label: string }[] = [
  { value: "", label: "Tất cả" },
  { value: "SUCCESS", label: "Thành công" },
  { value: "PENDING", label: "Đang chờ" },
  { value: "CANCELLED", label: "Đã hủy" }
];

export default function AdminRevenuePage() {
  const [status, setStatus] = useState<TxStatus | "">("");
  const [page, setPage] = useState(1);
  const overview = useAdminData<{ overview: AdminOverview }>("/admin/overview");
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const list = useAdminData<AdminTransactionPage>(`/admin/transactions?${params}`);
  const revenue = overview.data?.overview.revenue;
  const lastPage = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.page_size)) : 1;

  return (
    <>
      <AdminPageHeader
        title="Doanh thu"
        description="Giao dịch PayOS và trạng thái đối soát."
        actions={<RefreshButton loading={overview.loading || list.loading} onClick={() => { overview.reload(); list.reload(); }} />}
      />
      {(overview.error || list.error) && <AdminNotice>{overview.error || list.error}</AdminNotice>}

      {revenue && (
        <section className="admin-kpi-row" aria-label="Chỉ số doanh thu">
          <KpiCard label="Tổng doanh thu" value={fmtVnd(revenue.total_vnd)} hint="Giao dịch thành công" />
          <KpiCard label="Thành công" value={fmtNumber(revenue.success_count)} hint="Đã cộng credits" />
          <KpiCard label="Đang chờ" value={fmtNumber(revenue.pending_count)} hint="Chưa nhận webhook PayOS" />
          <KpiCard label="Đã hủy" value={fmtNumber(revenue.cancelled_count)} />
        </section>
      )}

      <AdminCard
        label="Danh sách giao dịch"
        title="Giao dịch"
        description={list.data ? `${fmtNumber(list.data.total)} giao dịch` : undefined}
        actions={
          <div className="admin-segmented admin-segmented-sm" role="group" aria-label="Lọc trạng thái">
            {FILTERS.map((filter) => (
              <button key={filter.label} type="button" className={status === filter.value ? "is-active" : ""} aria-pressed={status === filter.value}
                onClick={() => { setStatus(filter.value); setPage(1); }}>
                {filter.label}
              </button>
            ))}
          </div>
        }
      >
        {list.data && list.data.transactions.length === 0 && <EmptyState>Chưa có giao dịch nào{status ? " ở trạng thái này" : ""}.</EmptyState>}
        {list.data && list.data.transactions.length > 0 && (
          <div className="admin-table-wrap" aria-busy={list.loading}>
            <table className="admin-table">
              <thead><tr><th>Mã đơn</th><th>Người dùng</th><th className="num">Số tiền</th><th>Trạng thái</th><th>Thời gian</th></tr></thead>
              <tbody>
                {list.data.transactions.map((tx) => (
                  <tr key={tx.order_code}>
                    <td><code className="admin-code">#{tx.order_code}</code></td>
                    <td>{tx.user_email ?? "—"}{tx.user_code && <small className="admin-muted"> · ID {tx.user_code}</small>}</td>
                    <td className="num">{fmtVnd(tx.amount)}</td>
                    <td><span className={`admin-badge admin-badge-${tx.status.toLowerCase()}`}>{TX_STATUS_LABELS[tx.status]}</span></td>
                    <td>{fmtDateTime(tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && lastPage > 1 && (
          <nav className="admin-pager" aria-label="Phân trang giao dịch">
            <button type="button" className="secondary-button" disabled={page <= 1 || list.loading} onClick={() => setPage(page - 1)}>← Trước</button>
            <span>Trang {page}/{lastPage}</span>
            <button type="button" className="secondary-button" disabled={page >= lastPage || list.loading} onClick={() => setPage(page + 1)}>Sau →</button>
          </nav>
        )}
      </AdminCard>
    </>
  );
}
