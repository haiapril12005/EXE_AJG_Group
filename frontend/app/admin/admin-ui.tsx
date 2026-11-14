"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../utils/api";
import { useApp } from "../app-frame";

// ---------- Formatting ----------

export const fmtNumber = (value: number) => Math.round(value).toLocaleString("vi-VN");

export function fmtVnd(value: number): string {
  // Small AI costs keep one decimal so a 0.4đ call does not read as free.
  if (value > 0 && value < 10) return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}đ`;
  return `${Math.round(value).toLocaleString("vi-VN")}đ`;
}

export function fmtCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}M`;
  if (value >= 10_000) return `${(value / 1_000).toLocaleString("vi-VN", { maximumFractionDigits: 0 })}K`;
  return fmtNumber(value);
}

export const fmtDate = (value: string) => new Date(value).toLocaleDateString("vi-VN");
export const fmtDateTime = (value: string) =>
  new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
/** "2026-11-14" → "14/11" */
export const fmtDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

export const fmtPercent = (part: number, whole: number) => whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

// ---------- Data ----------

/** Loads one admin endpoint; `reload` fetches it again. */
export function useAdminData<T>(path: string | null) {
  const { token } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setLoading(true);
    setError("");
    void api<T>(path, token).then((result) => {
      if (active) setData(result);
    }).catch((err: Error) => {
      if (active) { setData(null); setError(err.message); }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
    // A refreshed token does not change the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, error, loading, reload };
}

// ---------- Layout pieces ----------

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="admin-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="admin-page-actions">{actions}</div>}
    </header>
  );
}

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (value: Period) => void }) {
  return (
    <div className="admin-segmented" role="group" aria-label="Khoảng thời gian">
      {PERIODS.map((days) => (
        <button key={days} type="button" className={value === days ? "is-active" : ""} aria-pressed={value === days} onClick={() => onChange(days)}>
          {days} ngày
        </button>
      ))}
    </div>
  );
}

export function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button type="button" className="secondary-button admin-refresh" disabled={loading} onClick={onClick}>
      {loading ? "Đang tải..." : "↻ Làm mới"}
    </button>
  );
}

export function AdminCard({ title, description, actions, children, className = "", label }: {
  title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string; label?: string;
}) {
  return (
    <section className={`soft-card admin-card ${className}`} aria-label={label ?? title}>
      {(title || actions) && (
        <div className="admin-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Change against the previous period; null when there is nothing to compare with. */
export function changeOf(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function KpiCard({ label, value, hint, change }: { label: string; value: string; hint?: ReactNode; change?: number | null }) {
  return (
    <article className="soft-card admin-kpi">
      <span className="admin-kpi-label">{label}</span>
      <strong className="admin-kpi-number">{value}</strong>
      <div className="admin-kpi-foot">
        {change !== undefined && change !== null && (
          <span className={`admin-delta ${change > 0 ? "is-up" : change < 0 ? "is-down" : ""}`}>
            <span aria-hidden="true">{change > 0 ? "▲" : change < 0 ? "▼" : "•"}</span> {Math.abs(change)}%
            <span className="visually-hidden"> so với kỳ trước</span>
          </span>
        )}
        {hint && <span className="admin-kpi-hint">{hint}</span>}
      </div>
    </article>
  );
}

export function AdminNotice({ children }: { children: ReactNode }) {
  return <p role="status" className="notice notice-info admin-notice">{children}</p>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}

// ---------- Charts ----------

/** A rounded axis maximum with 3 even steps (0, ⅓, ⅔, max). */
function niceMax(value: number): number {
  if (value <= 3) return 3;
  const raw = value / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
  return step * 3;
}

/**
 * One series of vertical bars over days. Each bar shows its value on hover or focus, and the same
 * numbers are available as a table for screen readers and for copying.
 */
export function DailyBarChart({ data, label, format = fmtNumber }: {
  data: { day: string; value: number }[];
  label: string;
  format?: (value: number) => string;
}) {
  const max = niceMax(Math.max(0, ...data.map((point) => point.value)));
  const ticks = [max, (max * 2) / 3, max / 3, 0];
  const labelEvery = data.length > 45 ? 14 : data.length > 14 ? 5 : 1;
  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <figure className="admin-chart">
      <div className="admin-chart-plot">
        <div className="admin-chart-axis" aria-hidden="true">
          {ticks.map((tick) => <span key={tick}>{fmtCompact(tick)}</span>)}
        </div>
        <div className="admin-chart-area">
          <div className="admin-chart-grid" aria-hidden="true">{ticks.map((tick) => <span key={tick} />)}</div>
          <div className="admin-chart-bars" style={{ gap: data.length > 45 ? 1 : 2 }}>
            {data.map((point, index) => (
              <div key={point.day} className="admin-bar-slot" tabIndex={0} aria-label={`${fmtDay(point.day)}: ${format(point.value)}`}>
                <span className="admin-bar" style={{ height: `${max ? (point.value / max) * 100 : 0}%` }} />
                <span className="admin-bar-tip" role="tooltip">
                  <b>{format(point.value)}</b> {fmtDay(point.day)}
                </span>
                {/* Every Nth day and the last one, skipping a regular label that would touch the last. */}
                {(index === data.length - 1 || (index % labelEvery === 0 && data.length - 1 - index >= labelEvery / 2)) && (
                  <span className="admin-bar-label" aria-hidden="true">{fmtDay(point.day)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <details className="admin-chart-table">
        <summary>Xem bảng số liệu ({label}, tổng {format(total)})</summary>
        <table>
          <thead><tr><th>Ngày</th><th>{label}</th></tr></thead>
          <tbody>{data.map((point) => <tr key={point.day}><td>{fmtDay(point.day)}</td><td>{format(point.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Horizontal bars for a ranked list; `note` is shown after the value (e.g. a share). */
export function BarList({ items, format = fmtNumber, max }: {
  items: { key: string; label: ReactNode; value: number; note?: string }[];
  format?: (value: number) => string;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="admin-barlist">
      {items.map((item) => (
        <li key={item.key}>
          <div className="admin-barlist-row">
            <span className="admin-barlist-label">{item.label}</span>
            <span className="admin-barlist-value">{format(item.value)}{item.note && <small> · {item.note}</small>}</span>
          </div>
          <span className="admin-barlist-track" aria-hidden="true">
            <span style={{ width: `${Math.max(item.value > 0 ? 1.5 : 0, (item.value / top) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
