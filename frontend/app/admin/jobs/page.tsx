"use client";

import {
  AdminCard, AdminNotice, AdminPageHeader, BarList, EmptyState, fmtDateTime, fmtNumber, fmtPercent, KpiCard, RefreshButton, useAdminData
} from "../admin-ui";
import type { AdminJobStats } from "../types";

const SOURCE_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  smartrecruiters: "SmartRecruiters",
  lever: "Lever",
  ashby: "Ashby"
};

export default function AdminJobsPage() {
  const { data, error, loading, reload } = useAdminData<{ stats: AdminJobStats }>("/admin/jobs");
  const s = data?.stats;
  const hoursSinceSync = s?.last_seen_at ? (Date.now() - new Date(s.last_seen_at).getTime()) / 3_600_000 : null;

  return (
    <>
      <AdminPageHeader
        title="Kho việc làm"
        description="Số tin tuyển dụng đang mở theo nguồn và ngành nghề."
        actions={<RefreshButton loading={loading} onClick={reload} />}
      />
      {error && <AdminNotice>{error}</AdminNotice>}

      {s && (
        <>
          <section className="admin-kpi-row admin-kpi-row-3" aria-label="Chỉ số kho việc làm">
            <KpiCard label="Tin đang mở" value={fmtNumber(s.active)} hint={`${s.by_category.length} ngành nghề`} />
            <KpiCard label="Tin đã đóng" value={fmtNumber(s.inactive)} hint="Không còn trên trang tuyển dụng gốc" />
            <KpiCard
              label="Đồng bộ gần nhất"
              value={s.last_seen_at ? fmtDateTime(s.last_seen_at) : "Chưa có"}
              hint={hoursSinceSync !== null && hoursSinceSync > 24
                ? <span className="admin-warn">Quá 24 giờ — kiểm tra lịch đồng bộ</span>
                : "Chạy thủ công: npm run jobs:sync"}
            />
          </section>

          <div className="admin-grid-2">
            <AdminCard title="Theo nguồn">
              {s.by_source.length ? (
                <BarList items={s.by_source.map((row) => ({
                  key: row.source, label: SOURCE_LABELS[row.source] ?? row.source, value: row.active, note: fmtPercent(row.active, s.active)
                }))} />
              ) : <EmptyState>Chưa có tin nào.</EmptyState>}
            </AdminCard>
            <AdminCard title="Theo ngành nghề" description="Ngành ít tin là chỗ nên bổ sung nguồn tuyển dụng.">
              {s.by_category.length ? (
                <BarList items={s.by_category.map((row) => ({
                  key: row.category, label: row.label, value: row.active, note: fmtPercent(row.active, s.active)
                }))} />
              ) : <EmptyState>Chưa có tin nào.</EmptyState>}
            </AdminCard>
          </div>
        </>
      )}
    </>
  );
}
