"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useApp } from "../app-frame";
import "./admin.css";

const SECTIONS = [
  { href: "/admin", label: "Tổng quan", icon: "M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z" },
  { href: "/admin/users", label: "Người dùng", icon: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm13 9v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74" },
  { href: "/admin/ai", label: "AI & Chi phí", icon: "M12 3v3m0 12v3M3 12h3m12 0h3M7 7h10v10H7zm3 3h4v4h-4z" },
  { href: "/admin/revenue", label: "Doanh thu", icon: "M3 7h18v10H3zM3 11h18M7 15h3" },
  { href: "/admin/jobs", label: "Kho việc làm", icon: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 7h18v12H3zm0 6h18" },
  { href: "/admin/system", label: "Hệ thống", icon: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" }
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile } = useApp();
  // A non-admin sees only the page itself, which explains that access is refused.
  if (!profile?.is_admin) return <div className="admin-main">{children}</div>;

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <nav aria-label="Quản trị">
          {SECTIONS.map((section) => {
            const active = section.href === "/admin" ? pathname === "/admin" : pathname.startsWith(section.href);
            return (
              <Link key={section.href} href={section.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={section.icon} />
                </svg>
                {section.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
