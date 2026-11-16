"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AdminCard, AdminNotice, AdminPageHeader, BarList, changeOf, DailyBarChart, fmtDateTime, fmtNumber, fmtPercent, fmtVnd,
  KpiCard, PeriodPicker, RefreshButton, useAdminData, type Period
} from "./admin-ui";
import type { AdminActivity, AdminOverview } from "./types";

const METRICS = [
  { key: "new_users", label: "Đăng ký mới" },
  { key: "analyses", label: "Lượt phân tích" },
  { key: "interviews", label: "Phỏng vấn AI" },
  { key: "cvs", label: "CV mới" }
] as const;

export default function AdminOverviewPage() {
  const [days, setDays] = useState<Period>(30);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("new_users");
  const overview = useAdminData<{ overview: AdminOverview }>("/admin/overview");
  // The activity charts need migration 011; until then the page still shows the overview figures.
  const activity = useAdminData<{ activity: AdminActivity }>(overview.data ? `/admin/activity?days=${days}` : null);
  const o = overview.data?.overview;
  const a = activity.data?.activity;

  function refresh() {
    overview.reload();
    activity.reload();
  }

  if (overview.error) {
    return (
      <>
        <AdminPageHeader title="Tổng quan" />
        <AdminNotice>{overview.error}</AdminNotice>
        <p className="muted-copy">Quyền quản trị chỉ được cấp qua lệnh CLI với khóa bí mật máy chủ, cho tài khoản đã xác thực email và tối đa 3 tài khoản.</p>
        <Link href="/jobs" className="inline-link">← Về ứng dụng</Link>
      </>
    );
  }

  const metricLabel = METRICS.find((item) => item.key === metric)!.label;
  const funnelSteps = a ? [
    { key: "signed_up", label: "Đăng ký tài khoản", value: a.funnel.signed_up },
    { key: "has_cv", label: "Có ít nhất 1 CV", value: a.funnel.has_cv },
    { key: "analyzed", label: "Đã phân tích CV–JD", value: a.funnel.analyzed },
    { key: "interviewed", label: "Đã luyện phỏng vấn", value: a.funnel.interviewed },
    { key: "paid", label: "Đã thanh toán", value: a.funnel.paid }
  ] : [];

  return (
    <>
      <AdminPageHeader
        title="Tổng quan"
        description={o ? `Cập nhật lúc ${fmtDateTime(o.generated_at)}` : "Đang tải số liệu..."}
        actions={<><PeriodPicker value={days} onChange={setDays} /><RefreshButton loading={overview.loading || activity.loading} onClick={refresh} /></>}
      />

      {o && (
        <section className="admin-kpi-row" aria-label="Chỉ số chính">
          <KpiCard
            label="Người dùng"
            value={fmtNumber(o.users.total)}
            change={a ? changeOf(a.current.new_users, a.previous.new_users) : undefined}
            hint={a ? `+${fmtNumber(a.current.new_users)} trong ${days} ngày` : `+${o.users.new_last_7d} trong 7 ngày`}
          />
          <KpiCard
            label="Hoạt động 7 ngày"
            value={a ? fmtNumber(a.funnel.active_7d) : "—"}
            hint={a ? `${fmtPercent(a.funnel.active_7d, o.users.total)} tổng người dùng` : "Cần migration 011"}
          />
          <KpiCard
            label={`Phân tích (${days} ngày)`}
            value={a ? fmtNumber(a.current.analyses) : fmtNumber(o.analyses.total)}
            change={a ? changeOf(a.current.analyses, a.previous.analyses) : undefined}
            hint={`Tổng ${fmtNumber(o.analyses.total)} · RCI TB ${o.analyses.avg_rci_score ?? "—"}%`}
          />
          <KpiCard
            label="Doanh thu"
            value={fmtVnd(o.revenue.total_vnd)}
            hint={`${o.revenue.success_count} giao dịch thành công`}
          />
        </section>
      )}

      {activity.error && <AdminNotice>{activity.error}</AdminNotice>}

      {a && (
        <div className="admin-grid-2-1">
          <AdminCard
            title="Hoạt động theo ngày"
            description={`${metricLabel} trong ${days} ngày qua`}
            actions={
              <div className="admin-segmented admin-segmented-sm" role="group" aria-label="Chỉ số biểu đồ">
                {METRICS.map((item) => (
                  <button key={item.key} type="button" className={metric === item.key ? "is-active" : ""} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>
                    {item.label}
                  </button>
                ))}
              </div>
            }
          >
            <DailyBarChart label={metricLabel} data={a.daily.map((row) => ({ day: row.day, value: row[metric] }))} />
          </AdminCard>

          <AdminCard title="Phễu chuyển đổi" description="Số người dùng đã đi tới từng bước (toàn thời gian)">
            <BarList
              max={a.funnel.signed_up || 1}
              items={funnelSteps.map((step, index) => ({
                key: step.key,
                label: <><span className="admin-step-index">{index + 1}</span>{step.label}</>,
                value: step.value,
                note: index === 0 ? undefined : fmtPercent(step.value, a.funnel.signed_up)
              }))}
            />
            <p className="admin-footnote">Bước tụt mạnh nhất là chỗ nên cải thiện trải nghiệm trước.</p>
          </AdminCard>
        </div>
      )}

      {o && (
        <div className="admin-grid-3">
          <AdminCard title="Hồ sơ CV">
            <dl className="admin-stats">
              <div><dt>Tổng CV</dt><dd>{fmtNumber(o.cvs.total)}</dd></div>
              <div><dt>Lượt chấm chất lượng</dt><dd>{fmtNumber(o.cvs.evaluations_total)}</dd></div>
              <div><dt>Điểm chất lượng TB</dt><dd>{o.cvs.avg_quality_score !== null ? `${o.cvs.avg_quality_score}/100` : "—"}</dd></div>
            </dl>
          </AdminCard>
          <AdminCard title="Phỏng vấn AI">
            <dl className="admin-stats">
              <div><dt>Tổng phiên</dt><dd>{fmtNumber(o.interviews.total)}</dd></div>
              <div><dt>Hoàn thành</dt><dd>{fmtNumber(o.interviews.completed)} <small>({fmtPercent(o.interviews.completed, o.interviews.total)})</small></dd></div>
              <div><dt>Câu trả lời</dt><dd>{fmtNumber(o.interviews.answers_total)}</dd></div>
            </dl>
          </AdminCard>
          <AdminCard title="Phân tích CV–JD">
            <dl className="admin-stats">
              <div><dt>Tổng lượt</dt><dd>{fmtNumber(o.analyses.total)}</dd></div>
              <div><dt>Phù hợp cao (≥ 70%)</dt><dd>{fmtNumber(o.analyses.high_match_count)} <small>({fmtPercent(o.analyses.high_match_count, o.analyses.total)})</small></dd></div>
              <div><dt>Việc làm đang mở</dt><dd>{fmtNumber(o.jobs.active_count)}</dd></div>
            </dl>
          </AdminCard>
        </div>
      )}
    </>
  );
}
