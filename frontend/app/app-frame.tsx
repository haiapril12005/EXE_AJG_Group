"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Mascot } from "page-mascot";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { api } from "../utils/api";
import { createClient } from "../utils/supabase/client";
import { AuthScreen } from "./auth-screen";
import { ChatBox, clearChat } from "./chat-box";

const supabase = createClient();

export type Profile = {
  id: string;
  user_code?: string;
  email: string;
  full_name: string;
  phone?: string;
  avatar?: string | null;
  credits: number;
  is_admin?: boolean;
  created_at?: string;
  payments_enabled: boolean;
};

type AppState = {
  session: Session;
  token: string;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error("useApp must be used inside AppFrame");
  return state;
}

export function formatUserCode(id: string): string {
  const clean = id.replace(/[^0-9a-fA-F]/g, "").padEnd(32, "0");
  const head = Number.parseInt(clean.slice(0, 7), 16) || 0;
  const tail = Number.parseInt(clean.slice(25, 32), 16) || 0;
  const seed = head ^ tail;
  return String(10_000_000 + (seed % 90_000_000));
}

// The job list is the home page, so it comes first; the analysis form lives at /analyze.
const NAV_ITEMS = [
  { href: "/jobs", label: "Việc làm" },
  { href: "/analyze", label: "Phân tích" },
  { href: "/create", label: "Tạo CV" },
  { href: "/history", label: "Lịch sử" }
];

const WIDE_ROUTES = /^\/(?:create|cv|analysis)(?:\/|$)/;

function Brand() {
  return (
    <Link href="/jobs" className="brand">
      <span className="brand-mark" aria-hidden="true">♧</span>
      <span><strong>JOB <em>READY</em></strong><small>DỰ ÁN EXE101 · NHÓM 81</small></span>
    </Link>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button className="theme-toggle" type="button" onClick={onToggle} aria-label={theme === "light" ? "Bật giao diện tối" : "Bật giao diện sáng"}>
      <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
    </button>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const token = session?.access_token ?? "";
  const userId = session?.user.id;

  useEffect(() => {
    setAccountOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("cv-fit-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("cv-fit-theme", next);
  }

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setNotice(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const result = await api<{ user: Profile }>("/user/me", token);
      if (result.user.is_admin === undefined && userId) {
        const { data } = await supabase.from("users").select("is_admin").eq("id", userId).maybeSingle();
        result.user.is_admin = Boolean(data?.is_admin);
      }
      setProfile(result.user);
    } catch (error) {
      if (userId) {
        const { data } = await supabase.from("users").select("id,email,full_name,credits,is_admin").eq("id", userId).maybeSingle();
        if (data) {
          setProfile({ ...data, is_admin: Boolean(data.is_admin), payments_enabled: false });
          return;
        }
      }
      throw error;
    }
  }, [token, userId]);

  useEffect(() => {
    if (userId) void refreshProfile().catch((error: Error) => setNotice(error.message));
    // A refreshed token belongs to the same user, so the profile stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Signing in from the home page opens the job list. A link to a specific page (a shared report,
  // an interview) stays on that page after sign-in.
  function signedIn(next: Session) {
    if (pathname === "/") router.replace("/jobs");
    setSession(next);
  }

  async function signOut() {
    setAccountOpen(false);
    if (userId) clearChat(userId);
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(`Không thể đăng xuất: ${error.message}`);
  }

  const themeClass = theme === "dark" ? "theme-dark" : "";
  if (authLoading) return <main className={`app-shell loading-shell ${themeClass}`}><p>Đang kiểm tra phiên đăng nhập...</p></main>;
  if (!session) return <AuthScreen onSession={signedIn} header={<Brand />} />;

  const displayName = profile?.full_name || (session.user.user_metadata?.full_name as string | undefined) || session.user.email || "Người dùng";
  const displayId = profile?.id || session.user.id;
  const userCode = profile?.user_code || formatUserCode(displayId);

  return (
    <AppContext.Provider value={{ session, token, profile, refreshProfile, signOut }}>
      <main className={`app-shell ${themeClass}`}>
        <header className="site-header no-print">
          <div className="header-inner">
            <Brand />
            <nav className="app-nav" aria-label="Điều hướng chính">
              {[...NAV_ITEMS, ...(profile?.is_admin ? [{ href: "/admin", label: "Quản trị" }] : [])].map((item) => {
                const active = pathname.startsWith(item.href);
                return <Link key={item.href} href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>{item.label}</Link>;
              })}
            </nav>
            <div className="header-actions">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              <span className="header-divider" />
              {profile?.payments_enabled && <span className="credits-chip">Credits <strong>{profile.credits}</strong></span>}
              <div className="account-menu-wrap" ref={menuRef}>
                <button
                  type="button"
                  className="profile-chip account-trigger"
                  aria-label="Menu tài khoản"
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  onClick={() => setAccountOpen((open) => !open)}
                >
                  {profile?.avatar
                    ? <img className="avatar avatar-photo" src={profile.avatar} alt="" />
                    : <span className="avatar">{displayName.trim().charAt(0).toUpperCase()}</span>}
                  <span className="profile-meta">
                    <span className="profile-name-line">
                      <span className="profile-name">{displayName}</span>
                      {profile?.is_admin && <span className="admin-role-pill">ADMIN</span>}
                    </span>
                    <small className="profile-uid">ID: {userCode}</small>
                  </span>
                  <span className="account-caret" aria-hidden="true">▾</span>
                </button>

                {accountOpen && (
                  <div className="account-dropdown" role="menu" aria-label="Tùy chọn tài khoản">
                    <div className="account-dropdown-head">
                      <div className="account-dropdown-title">
                        <strong>{displayName}</strong>
                        {profile?.is_admin && <span className="admin-role-pill">ADMIN</span>}
                      </div>
                      <small className="account-dropdown-uid">ID: {userCode}</small>
                      <small className="account-dropdown-sub">
                        {profile?.email || session.user.email}
                        {profile?.phone ? ` · ${profile.phone}` : ""}
                      </small>
                    </div>

                    <div className="account-dropdown-links" onClick={() => setAccountOpen(false)}>
                      <Link href="/profile" role="menuitem" className="account-menu-item">
                        <strong>Hồ sơ cá nhân</strong>
                      </Link>
                      <Link href="/jobs?saved=1" role="menuitem" className="account-menu-item">
                        <strong>Việc làm xem sau</strong>
                      </Link>
                      <Link href="/history" role="menuitem" className="account-menu-item">
                        <strong>Lịch sử hoạt động</strong>
                      </Link>
                      {profile?.is_admin && (
                        <Link href="/admin" role="menuitem" className="account-menu-item">
                          <strong>Thống kê</strong>
                        </Link>
                      )}
                    </div>

                    <div className="account-dropdown-footer">
                      <button type="button" role="menuitem" className="account-logout-btn" onClick={() => void signOut()}>
                        Đăng xuất
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className={`page-content ${WIDE_ROUTES.test(pathname) ? "page-wide" : ""}`}>
          <div className="page-mascot-bar no-print">
            <Mascot
              directions="/mascots/frog-directions.webp"
              reactions="/mascots/frog-reactions.webp"
            />
          </div>
          {notice && <p role="status" className="notice notice-info no-print">{notice}</p>}
          {children}
          <footer className="site-footer no-print"><span>Job Ready · Phân tích có trách nhiệm, không bịa đặt thông tin hồ sơ.</span><span>{profile ? (profile.payments_enabled ? `Còn lại ${profile.credits} credits` : "Dùng thử miễn phí") : ""}</span></footer>
        </div>
        <ChatBox />
      </main>
    </AppContext.Provider>
  );
}
