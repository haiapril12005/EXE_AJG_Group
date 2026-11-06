"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { api } from "../utils/api";
import { createClient } from "../utils/supabase/client";
import { AuthScreen } from "./auth-screen";

const supabase = createClient();

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  credits: number;
  payments_enabled: boolean;
};

type AppState = {
  session: Session;
  token: string;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error("useApp must be used inside AppFrame");
  return state;
}

const NAV_ITEMS = [
  { href: "/", label: "Phân tích" },
  { href: "/jobs", label: "Việc làm" },
  { href: "/create", label: "Tạo CV" },
  { href: "/history", label: "Lịch sử" }
];

const WIDE_ROUTES = /^\/(?:create|cv|analysis)(?:\/|$)/;

function Brand() {
  return (
    <Link href="/" className="brand">
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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState("");
  const token = session?.access_token ?? "";
  const userId = session?.user.id;

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
    const result = await api<{ user: Profile }>("/user/me", token);
    setProfile(result.user);
  }, [token]);

  useEffect(() => {
    if (userId) void refreshProfile().catch((error: Error) => setNotice(error.message));
    // A refreshed token belongs to the same user, so the profile stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(`Không thể đăng xuất: ${error.message}`);
  }

  const themeClass = theme === "dark" ? "theme-dark" : "";
  if (authLoading) return <main className={`app-shell loading-shell ${themeClass}`}><p>Đang kiểm tra phiên đăng nhập...</p></main>;
  if (!session) return <AuthScreen onSession={setSession} header={<Brand />} />;

  return (
    <AppContext.Provider value={{ session, token, profile, refreshProfile }}>
      <main className={`app-shell ${themeClass}`}>
        <header className="site-header no-print">
          <div className="header-inner">
            <Brand />
            <nav className="app-nav" aria-label="Điều hướng chính">
              {NAV_ITEMS.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return <Link key={item.href} href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>{item.label}</Link>;
              })}
            </nav>
            <div className="header-actions">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              <span className="header-divider" />
              <div className="profile-chip">
                <span className="avatar">{(profile?.full_name || session.user.email || "U").trim().charAt(0).toUpperCase()}</span>
                <span className="profile-name">{profile?.full_name || session.user.email}</span>
              </div>
              {profile?.payments_enabled && <span className="credits-chip">Credits <strong>{profile.credits}</strong></span>}
              <button className="text-button" onClick={() => void signOut()}>Đăng xuất</button>
            </div>
          </div>
        </header>

        <div className={`page-content ${WIDE_ROUTES.test(pathname) ? "page-wide" : ""}`}>
          {notice && <p role="status" className="notice notice-info no-print">{notice}</p>}
          {children}
          <footer className="site-footer no-print"><span>Job Ready · Phân tích có trách nhiệm, không bịa đặt thông tin hồ sơ.</span><span>{profile ? (profile.payments_enabled ? `Còn lại ${profile.credits} credits` : "Dùng thử miễn phí") : ""}</span></footer>
        </div>
      </main>
    </AppContext.Provider>
  );
}
