"use client";

import { useState } from "react";
import {
  AdminCard, AdminNotice, AdminPageHeader, BarList, DailyBarChart, EmptyState, fmtCompact, fmtNumber, fmtPercent, fmtVnd,
  KpiCard, PeriodPicker, RefreshButton, useAdminData, type Period
} from "../admin-ui";
import type { AiUsageReport } from "../types";

export default function AdminAiPage() {
  const [days, setDays] = useState<Period>(30);
  const [chart, setChart] = useState<"cost" | "tokens">("cost");
  const { data, error, loading, reload } = useAdminData<{ report: AiUsageReport }>(`/admin/ai-usage?days=${days}`);
  const r = data?.report;

  return (
    <>
      <AdminPageHeader
        title="AI & Chi phí"
        description="Token và chi phí ước tính của mọi lần gọi AI, theo ngày, tính năng và người dùng."
        actions={<><PeriodPicker value={days} onChange={setDays} /><RefreshButton loading={loading} onClick={reload} /></>}
      />
      {error && <AdminNotice>{error}</AdminNotice>}

      {r && (
        <>
          <section className="admin-kpi-row" aria-label="Chỉ số AI">
            <KpiCard label="Chi phí ước tính" value={fmtVnd(r.totals.cost_vnd)} hint={r.totals.calls ? `≈ ${fmtVnd(r.totals.cost_vnd / r.totals.calls)} / lượt` : `${days} ngày qua`} />
            <KpiCard label="Tổng token" value={fmtCompact(r.totals.total_tokens)} hint={`Vào ${fmtCompact(r.totals.input_tokens)} · Ra ${fmtCompact(r.totals.output_tokens + r.totals.thought_tokens)}`} />
            <KpiCard label="Lượt gọi AI" value={fmtNumber(r.totals.calls)} hint={r.totals.failed ? `${fmtNumber(r.totals.failed)} lỗi (${fmtPercent(r.totals.failed, r.totals.calls)})` : "Không có lỗi"} />
            <KpiCard label="Độ trễ trung bình" value={r.totals.calls ? `${(r.totals.avg_latency_ms / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}s` : "—"} hint="Mỗi lần gọi model" />
          </section>

          {r.totals.calls === 0 ? (
            <AdminCard>
              <EmptyState>Chưa có lần gọi AI nào được ghi nhận trong {days} ngày qua. Số liệu bắt đầu có từ khi migration 011 được chạy.</EmptyState>
            </AdminCard>
          ) : (
            <>
              <AdminCard
                title={chart === "cost" ? "Chi phí theo ngày" : "Token theo ngày"}
                actions={
                  <div className="admin-segmented admin-segmented-sm" role="group" aria-label="Chỉ số biểu đồ">
                    <button type="button" className={chart === "cost" ? "is-active" : ""} aria-pressed={chart === "cost"} onClick={() => setChart("cost")}>Chi phí</button>
                    <button type="button" className={chart === "tokens" ? "is-active" : ""} aria-pressed={chart === "tokens"} onClick={() => setChart("tokens")}>Token</button>
                  </div>
                }
              >
                <DailyBarChart
                  label={chart === "cost" ? "Chi phí" : "Token"}
                  format={chart === "cost" ? fmtVnd : fmtNumber}
                  data={r.daily.map((row) => ({ day: row.day, value: chart === "cost" ? row.cost_vnd : row.total_tokens }))}
                />
              </AdminCard>

              <AdminCard title="Theo tính năng" description="Tính năng nào tốn nhiều nhất, và mỗi lượt dùng tốn bao nhiêu — cơ sở để định giá gói Pro.">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr><th>Tính năng</th><th className="num">Lượt gọi</th><th className="num">Token</th><th className="num">Chi phí</th><th className="num">TB / lượt</th><th className="admin-share-col">Tỉ trọng chi phí</th></tr>
                    </thead>
                    <tbody>
                      {r.by_feature.map((row) => (
                        <tr key={row.feature}>
                          <td><strong>{row.label}</strong>{row.failed > 0 && <small className="admin-warn"> · {row.failed} lỗi</small>}</td>
                          <td className="num">{fmtNumber(row.calls)}</td>
                          <td className="num">{fmtCompact(row.total_tokens)}</td>
                          <td className="num">{fmtVnd(row.cost_vnd)}</td>
                          <td className="num">{fmtVnd(row.avg_cost_vnd)}</td>
                          <td className="admin-share-col">
                            <span className="admin-share">
                              <span className="admin-barlist-track" aria-hidden="true"><span style={{ width: `${r.totals.cost_vnd ? (row.cost_vnd / r.totals.cost_vnd) * 100 : 0}%` }} /></span>
                              <small>{fmtPercent(row.cost_vnd, r.totals.cost_vnd)}</small>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AdminCard>

              <div className="admin-grid-2">
                <AdminCard title="Người dùng tốn nhiều nhất" description="Phát hiện sớm tài khoản dùng bất thường.">
                  {r.top_users.length ? (
                    <BarList
                      format={fmtVnd}
                      items={r.top_users.map((user) => ({
                        key: user.id,
                        label: <span className="admin-barlist-person"><strong>{user.full_name || user.email || user.user_code}</strong><small>{user.email} · ID {user.user_code}</small></span>,
                        value: user.cost_vnd,
                        note: `${fmtNumber(user.calls)} lượt`
                      }))}
                    />
                  ) : <EmptyState>Chưa có dữ liệu.</EmptyState>}
                </AdminCard>
                <AdminCard title="Theo model">
                  <BarList
                    format={fmtVnd}
                    items={r.by_model.map((row) => ({ key: row.model, label: <code className="admin-code">{row.model}</code>, value: row.cost_vnd, note: `${fmtNumber(row.calls)} lượt` }))}
                  />
                </AdminCard>
              </div>
            </>
          )}

          <p className="admin-footnote">
            Chi phí là ước tính theo đơn giá ${r.pricing.inputUsdPerM}/1M token vào, ${r.pricing.outputUsdPerM}/1M token ra (gồm token suy luận),
            tỉ giá {fmtNumber(r.pricing.usdVnd)}đ/USD. Chỉnh trong <code>backend/.env</code> (AI_PRICE_INPUT_USD_PER_M, AI_PRICE_OUTPUT_USD_PER_M, USD_VND_RATE) cho khớp bảng giá Gemini.
          </p>
        </>
      )}
    </>
  );
}
