"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { cx } from "@/lib/utils";

type NavItem = { label: string; href: string; icon: string };

const NAV: NavItem[] = [
  { label: "Home", href: "/", icon: "home" },
  { label: "Matches", href: "/matches", icon: "matches" },
  { label: "Ladder", href: "/ladder", icon: "ladder" },
  { label: "Memberships", href: "/clubs", icon: "clubs" },
  { label: "Profile", href: "/profile", icon: "profile" },
];

function titleFromPath(pathname: string) {
  const hit = NAV.find((n) => n.href === pathname);
  if (hit) return hit.label;
  if (pathname.startsWith("/matches")) return "Matches";
  if (pathname.startsWith("/ladder")) return "Ladder";
  if (pathname.startsWith("/clubs")) return "Memberships";
  if (pathname.startsWith("/profile")) return "Profile";
  return "Home";
}

function NavIcon({ name, size = 18 }: { name: string; size?: number }) {
  const s = size;
  switch (name) {
    case "home":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
          <polyline points="9 21 9 14 15 14 15 21" />
        </svg>
      );
    case "matches":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 19.24 7 20v2" />
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 19.24 17 20v2" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      );
    case "ladder":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20V10" />
          <path d="M18 20V4" />
          <path d="M6 20v-4" />
        </svg>
      );
    case "clubs":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
          <path d="M10 18h4" />
        </svg>
      );
    case "profile":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21a8 8 0 1 0-16 0" />
        </svg>
      );
    case "logout":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    default:
      return null;
  }
}

export function AppShell({
  children,
  userEmail,
  logoutHref = "/logout",
  loginHref = "/login",
  newMatchHref = "/matches/new",
}: {
  children: ReactNode;
  userEmail?: string | null;
  logoutHref?: string;
  loginHref?: string;
  newMatchHref?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const pageTitle = titleFromPath(pathname);

  const [email, setEmail] = useState((userEmail ?? "").trim());
  const [checkedSession, setCheckedSession] = useState(Boolean(userEmail));

  type Notif = { id: string; message: string; match_id: string | null; read: boolean; created_at: string };
  const [notifications, setNotifications] = useState<Notif[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const authRoutes = ["/login", "/forgot-password", "/reset-password", "/logout", "/auth", "/onboarding"];
  const isAuthRoute = authRoutes.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );

  const [profileChecked, setProfileChecked] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkProfileComplete(userId: string) {
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", userId)
          .maybeSingle();

        const hasName = Boolean((prof as any)?.display_name?.trim());
        if (!hasName) {
          router.replace("/onboarding");
          return;
        }

        const { data: memberships } = await supabase
          .from("club_memberships")
          .select("club_id")
          .eq("user_id", userId)
          .limit(1);

        const hasClub = (memberships ?? []).length > 0;
        if (!hasClub) {
          router.replace("/onboarding");
          return;
        }

        if (mounted) setProfileChecked(true);
      } catch {
        if (mounted) setProfileChecked(true);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const userEmail = (session?.user?.email ?? "").trim();
      setEmail(userEmail);
      setCheckedSession(true);

      if (!session?.user && !isAuthRoute) {
        router.replace("/login");
      } else if (session?.user && !isAuthRoute) {
        checkProfileComplete(session.user.id);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (!session?.user && !isAuthRoute) {
        router.replace("/login");
      } else if (session?.user && !isAuthRoute) {
        checkProfileComplete(session.user.id);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isAuthRoute, router]);

  // Fetch notifications
  useEffect(() => {
    if (!email) return;
    let mounted = true;

    async function fetchNotifs() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch("/api/notifications", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || !mounted) return;
        const json = await res.json();
        setNotifications(json.notifications ?? []);
        setUnreadCount(json.unreadCount ?? 0);
      } catch {}
    }

    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30000); // poll every 30s
    return () => { mounted = false; clearInterval(interval); };
  }, [email]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    }
    if (showNotifs) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showNotifs]);

  async function markAllRead() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "mark_read" }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  }

  const isAuthed = email.length > 0;

  if (isAuthRoute) {
    return <div className="min-h-screen bg-[var(--paper)]">{children}</div>;
  }

  if (!checkedSession || (!isAuthRoute && !profileChecked)) {
    return <div className="min-h-screen bg-[var(--paper)]" />;
  }

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[rgba(246,241,231,.14)] bg-[var(--pine)] text-[var(--paper)] shadow-[0_1px_3px_rgba(0,0,0,.12)]">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="text-[11px] font-medium tracking-[0.3em] opacity-90 hover:opacity-100">
              RECIPROCITY
            </Link>
            <span className="hidden text-[13px] opacity-40 sm:inline">/</span>
            <span className="hidden text-[13px] font-medium opacity-70 sm:inline">{pageTitle}</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-[13px] opacity-80 md:block">
              {isAuthed ? (
                <>
                  Signed in as <span className="font-medium opacity-100">{email}</span>
                </>
              ) : (
                <span className="opacity-70">Not signed in</span>
              )}
            </div>

            {isAuthed ? (
              <>
                <Link
                  href={newMatchHref}
                  className="rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs font-semibold text-[var(--pine)] shadow-[var(--shadow-sm)] transition hover:-translate-y-[1px] hover:shadow-[var(--shadow)] sm:px-4 sm:py-2 sm:text-sm"
                >
                  New match
                </Link>

                {/* Notification bell */}
                <div className="relative" ref={notifRef}>
                  <button
                    type="button"
                    onClick={() => setShowNotifs(!showNotifs)}
                    className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(246,241,231,.22)] transition hover:bg-[rgba(246,241,231,.08)]"
                  >
                    <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                    </svg>
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifs && (
                    <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-[var(--border)] bg-[var(--paper-2)] shadow-xl z-50">
                      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                        <span className="text-sm font-semibold text-[var(--ink)]">Notifications</span>
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={markAllRead}
                            className="text-xs text-[var(--pine)] font-medium"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      <div className="max-h-72 overflow-auto">
                        {notifications.length === 0 ? (
                          <div className="px-4 py-6 text-center text-xs text-[var(--muted)]">No notifications yet</div>
                        ) : (
                          notifications.map((n) => (
                            <Link
                              key={n.id}
                              href={n.match_id ? `/matches/${n.match_id}` : "#"}
                              onClick={() => setShowNotifs(false)}
                              className={cx(
                                "block px-4 py-3 text-sm border-b border-[var(--border)]/50 transition hover:bg-black/[0.02]",
                                !n.read && "bg-[var(--pine)]/[0.04]"
                              )}
                            >
                              <div className="flex items-start gap-2">
                                {!n.read && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[var(--pine)]" />}
                                <div className="min-w-0">
                                  <div className={cx("text-sm", !n.read ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]")}>
                                    {n.message}
                                  </div>
                                  <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                                    {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Link
                  href={logoutHref}
                  className="hidden rounded-full border border-[rgba(246,241,231,.22)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:border-[rgba(246,241,231,.40)] hover:bg-[rgba(246,241,231,.08)] sm:inline-flex"
                >
                  Logout
                </Link>
              </>
            ) : (
              <Link
                href={loginHref}
                className="rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs font-semibold text-[var(--pine)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow)] sm:px-4 sm:py-2 sm:text-sm"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="mx-auto w-full max-w-[1200px] gap-6 px-4 py-4 sm:px-6 sm:py-6 md:grid md:grid-cols-[240px_1fr]">
        {/* Desktop sidebar — hidden on mobile */}
        <aside className="hidden h-fit rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-4 shadow-[var(--shadow)] md:block">
          <div className="mb-4">
            <div className="text-[10px] font-medium tracking-[0.24em] text-[var(--muted)]">MENU</div>
          </div>

          <nav className="space-y-0.5">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition",
                    active
                      ? "bg-[rgba(11,59,46,.08)] font-medium text-[var(--pine)]"
                      : "text-[var(--ink)] hover:bg-[rgba(17,19,18,.04)]"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <NavIcon name={item.icon} size={16} />
                    <span>{item.label}</span>
                  </div>
                  <span
                    className={cx(
                      "h-1.5 w-1.5 rounded-full transition-opacity",
                      active ? "bg-[var(--pine)] opacity-100" : "opacity-0"
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="text-xs text-[var(--muted)]">
              Old-golf feel. Silicon-clean execution.
            </div>
          </div>
        </aside>

        {/* Content area */}
        <main className="min-w-0">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-4 shadow-[var(--shadow)] sm:p-6">
            {children}
          </div>

          <footer className="mt-6 hidden text-center text-xs text-[var(--muted)] md:block">
            &copy; {new Date().getFullYear()} Reciprocity &bull; Private club
            competition, refined
          </footer>
        </main>
      </div>

      {/* Mobile bottom tab bar — visible only on small screens */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--border)] bg-[var(--paper-2)] shadow-[0_-2px_12px_rgba(17,19,18,.06)] pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto flex max-w-md items-stretch">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-medium transition",
                  active
                    ? "text-[var(--pine)]"
                    : "text-[var(--muted)] active:text-[var(--ink)]"
                )}
              >
                <span
                  className={cx(
                    "flex h-8 w-8 items-center justify-center rounded-xl transition",
                    active
                      ? "bg-[rgba(11,59,46,.10)] text-[var(--pine)]"
                      : "text-[var(--muted)]"
                  )}
                >
                  <NavIcon name={item.icon} size={20} />
                </span>
                {item.label}
              </Link>
            );
          })}

          {/* Logout in tab bar for mobile */}
          {isAuthed && (
            <Link
              href={logoutHref}
              className="flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-medium text-[var(--muted)] transition active:text-[var(--ink)]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl">
                <NavIcon name="logout" size={20} />
              </span>
              Logout
            </Link>
          )}
        </div>
      </nav>

      {/* Spacer so content isn't hidden behind bottom tab bar on mobile */}
      <div className="h-20 md:hidden" />
    </div>
  );
}
