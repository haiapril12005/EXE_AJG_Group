"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Mascot } from "page-mascot";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { api } from "../utils/api";
import { createClient } from "../utils/supabase/client";
import { AuthScreen } from "./auth-screen";
import { ChatBox, clearChat } from "./chat-box";
import { usePlan } from "./plans";

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
  { href: "/photo-studio", label: "Ảnh CV AI" },
  { href: "/history", label: "Lịch sử" }
];

const WIDE_ROUTES = /^\/(?:create|cv|analysis|admin)(?:\/|$)/;
const ADMIN_AREA = /^\/admin(?:\/|$)/;
// Opening the site (or signing in) on one of these goes to the user's start page: /admin for admins,
// /jobs for everyone else. Any other path (a shared report, an interview) is kept as it is.
// "/?job=..." is an old link to the analysis form, which the home page redirects to itself.
const HOME_PATHS = new Set(["/", "/jobs"]);
const isHome = (path: string) => HOME_PATHS.has(path) && !window.location.search;
const startPageOf = (admin: boolean) => admin ? "/admin" : "/jobs";

function Brand({ href = "/jobs" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <span className="brand-mark" aria-hidden="true">♧</span>
      <span><strong>JOB <em>READY</em></strong><small>DỰ ÁN EXE101 · NHÓM 81</small></span>
    </Link>
  );
}

/**
 * Main navigation. The highlight behind the active item is one element that slides to the new item
 * on every route change, instead of each link switching its own background.
 */
function AppNav({ pathname }: { pathname: string }) {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const glassRef = useRef<HTMLSpanElement>(null);
  const sheenRef = useRef<HTMLSpanElement>(null);
  const prevPillRef = useRef<{ left: number; width: number } | null>(null);
  const activeHrefRef = useRef<string | null>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [optimisticHref, setOptimisticHref] = useState<string | null>(null);

  const routeHref = NAV_ITEMS.find((item) => pathname.startsWith(item.href))?.href ?? null;
  const activeHref = optimisticHref ?? routeHref;
  activeHrefRef.current = activeHref;

  useEffect(() => {
    setOptimisticHref(null);
  }, [pathname]);

  // Slide and morph the single Liquid Glass capsule from the previous item to the newly selected item.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = activeHref
      ? nav.querySelector<HTMLElement>(`a[data-nav-href="${activeHref}"]`)
      : nav.querySelector<HTMLElement>('a[aria-current="page"]');
    const next = active ? { left: active.offsetLeft, width: active.offsetWidth } : null;
    const prev = prevPillRef.current;
    const pillEl = pillRef.current;

    let from = prev;
    if (pillEl && prev && pillEl.getAnimations().length > 0) {
      const navRect = nav.getBoundingClientRect();
      const pillRect = pillEl.getBoundingClientRect();
      if (pillRect.width > 0) {
        from = { left: pillRect.left - navRect.left, width: pillRect.width };
      }
    }

    pillEl?.getAnimations().forEach((a) => a.cancel());
    glassRef.current?.getAnimations().forEach((a) => a.cancel());
    sheenRef.current?.getAnimations().forEach((a) => a.cancel());

    setPill(next);
    prevPillRef.current = next;

    if (from && next && Math.abs(next.left - from.left) > 2 && pillEl) {
      const dx = next.left - from.left;
      const dist = Math.abs(dx);
      const dir = dx >= 0 ? 1 : -1;
      const bridgeExtra = Math.min(dist * 0.5, 88);
      const midWidth = (from.width + next.width) * 0.5 + bridgeExtra;
      const midLeft = from.left + dx * 0.46 - (dir > 0 ? bridgeExtra * 0.34 : bridgeExtra * 0.66);
      const overshoot = dir * Math.min(5, dist * 0.035);

      pillEl.animate(
        [
          {
            transform: `translate3d(${from.left.toFixed(1)}px, 0, 0)`,
            width: `${from.width.toFixed(1)}px`
          },
          {
            transform: `translate3d(${midLeft.toFixed(1)}px, 0, 0)`,
            width: `${midWidth.toFixed(1)}px`,
            offset: 0.38
          },
          {
            transform: `translate3d(${(next.left + overshoot).toFixed(1)}px, 0, 0)`,
            width: `${next.width.toFixed(1)}px`,
            offset: 0.78
          },
          {
            transform: `translate3d(${next.left.toFixed(1)}px, 0, 0)`,
            width: `${next.width.toFixed(1)}px`
          }
        ],
        { duration: 580, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );

      glassRef.current?.animate(
        [
          { transform: "scaleY(1)" },
          { transform: "scaleY(0.84)", offset: 0.38 },
          { transform: "scaleY(1.04)", offset: 0.78 },
          { transform: "scaleY(1)" }
        ],
        { duration: 580, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );

      sheenRef.current?.animate(
        [
          { transform: `translateX(${-85 * dir}%) skewX(-18deg)`, opacity: 0 },
          { opacity: 0.9, offset: 0.36 },
          { transform: `translateX(${85 * dir}%) skewX(-18deg)`, opacity: 0 }
        ],
        { duration: 580, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
  }, [activeHref]);

  // Keep the capsule aligned on window resize or font load without interrupting an active transition.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const syncSize = () => {
      if (pillRef.current && pillRef.current.getAnimations().length > 0) return;
      const href = activeHrefRef.current;
      const active = href
        ? nav.querySelector<HTMLElement>(`a[data-nav-href="${href}"]`)
        : nav.querySelector<HTMLElement>('a[aria-current="page"]');
      const next = active ? { left: active.offsetLeft, width: active.offsetWidth } : null;
      prevPillRef.current = next;
      setPill(next);
    };
    const observer = new ResizeObserver(syncSize);
    observer.observe(nav);
    void document.fonts?.ready.then(syncSize);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navRef}
      className="app-nav"
      aria-label="Điều hướng chính"
    >
      <span
        ref={pillRef}
        className="app-nav-pill"
        aria-hidden="true"
        style={
          pill
            ? {
                transform: `translate3d(${pill.left}px, 0, 0)`,
                width: `${pill.width}px`,
                opacity: 1
              }
            : { opacity: 0, width: 0 }
        }
      >
        <span ref={glassRef} className="app-nav-pill-glass">
          <span ref={sheenRef} className="app-nav-pill-sheen" />
        </span>
      </span>
      {NAV_ITEMS.map((item) => {
        const active = item.href === activeHref;
        const currentRoute = item.href === routeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            data-nav-href={item.href}
            className={active ? "is-active" : ""}
            aria-current={currentRoute ? "page" : undefined}
            onClick={() => setOptimisticHref(item.href)}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
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
  // Where a sign-in or a remembered session should open. "waiting" until the profile says whether the
  // user is an admin, then the target path until the router has reached it; nothing is rendered
  // underneath meanwhile, so an admin never sees the user pages first.
  const [landing, setLanding] = useState<"none" | "waiting" | string>("none");
  const token = session?.access_token ?? "";
  const userId = session?.user.id;
  const { isPro } = usePlan(userId);

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
      if (data.session && isHome(pathname)) setLanding("waiting");
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
    if (userId) void refreshProfile().catch((error: Error) => {
      setNotice(error.message);
      // Without a profile the role is unknown, so the app opens as for a regular user.
      setLanding("none");
      if (pathname === "/") router.replace("/jobs");
    });
    // A refreshed token belongs to the same user, so the profile stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Once the profile has arrived, admins go to the dashboard and everyone else to the job list. The
  // check repeats on every path change: the home page redirects to /jobs on its own, and an admin
  // is sent on from there as well.
  useEffect(() => {
    if (landing === "none" || !profile || profile.id !== userId) return;
    const target = startPageOf(Boolean(profile.is_admin));
    if (pathname === target) {
      setLanding("none");
    } else if (isHome(pathname)) {
      setLanding(target);
      router.replace(target);
    } else {
      // The browser has moved to a specific page meanwhile (an old /?job= link); keep it.
      setLanding("none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, userId, landing, pathname]);

  function signedIn(next: Session) {
    setLanding(isHome(pathname) ? "waiting" : "none");
    setSession(next);
  }

  async function signOut() {
    setAccountOpen(false);
    if (userId) clearChat(userId);
    setLanding("none");
    const { error } = await supabase.auth.signOut();
    // The next account must not see this one's name or admin role while its own profile loads.
    if (!error) setProfile(null);
    if (error) setNotice(`Không thể đăng xuất: ${error.message}`);
  }

  const themeClass = theme === "dark" ? "theme-dark" : "";
  // The admin area has its own frame: no user navigation, mascot or assistant, and a way back.
  const inAdmin = ADMIN_AREA.test(pathname);
  if (authLoading) return <main className={`app-shell loading-shell ${themeClass}`}><p>Đang kiểm tra phiên đăng nhập...</p></main>;
  if (!session) return <AuthScreen onSession={signedIn} header={<Brand />} />;
  if (landing !== "none") return <main className={`app-shell loading-shell ${themeClass}`}><p>Đang mở trang của bạn...</p></main>;

  const displayName = profile?.full_name || (session.user.user_metadata?.full_name as string | undefined) || session.user.email || "Người dùng";
  const displayId = profile?.id || session.user.id;
  const userCode = profile?.user_code || formatUserCode(displayId);

  return (
    <AppContext.Provider value={{ session, token, profile, refreshProfile, signOut }}>
      <main className={`app-shell ${themeClass}${inAdmin ? " is-admin-area" : ""}`}>
        <header className="site-header no-print">
          <div className="header-inner">
            <div className="brand-row">
              <Brand href={inAdmin ? "/admin" : "/jobs"} />
              {inAdmin && <span className="admin-area-badge">Quản trị</span>}
            </div>
            {inAdmin ? (
              <Link href="/jobs" className="admin-exit-link">← Về ứng dụng</Link>
            ) : (
              <AppNav pathname={pathname} />
            )}
            <div className="header-actions">
              {!inAdmin && (isPro
                ? <Link href="/pricing" className="pro-chip" title="Gói Pro đang hoạt động">PRO</Link>
                : <Link href="/pricing" className="upgrade-button" aria-label="Nâng cấp Pro"><span aria-hidden="true">✦ <span className="upgrade-label">Nâng cấp </span>Pro</span></Link>)}
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
                      <Link href="/pricing" role="menuitem" className="account-menu-item">
                        <strong>Gói & thanh toán</strong>
                      </Link>
                      <Link href="/jobs?saved=1" role="menuitem" className="account-menu-item">
                        <strong>Việc làm xem sau</strong>
                      </Link>
                      <Link href="/history" role="menuitem" className="account-menu-item">
                        <strong>Lịch sử hoạt động</strong>
                      </Link>
                      {profile?.is_admin && (
                        inAdmin ? (
                          <Link href="/jobs" role="menuitem" className="account-menu-item">
                            <strong>← Về ứng dụng</strong>
                          </Link>
                        ) : (
                          <Link href="/admin" role="menuitem" className="account-menu-item account-menu-admin">
                            <strong>Trang quản trị</strong>
                          </Link>
                        )
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
          {!inAdmin && (
            <div className="page-mascot-bar no-print">
              <Mascot
                directions="/mascots/frog-directions.webp"
                reactions="/mascots/frog-reactions.webp"
              />
            </div>
          )}
          {notice && <p role="status" className="notice notice-info no-print">{notice}</p>}
          {children}
          <footer className="site-footer no-print"><span>Job Ready · Phân tích có trách nhiệm, không bịa đặt thông tin hồ sơ.</span><span>{profile ? (profile.payments_enabled ? `Còn lại ${profile.credits} credits` : "Dùng thử miễn phí") : ""}</span></footer>
        </div>
        {!inAdmin && <ChatBox />}
      </main>
    </AppContext.Provider>
  );
}
