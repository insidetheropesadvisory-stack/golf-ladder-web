"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/supabase";

type NavItem = { label: string; href: string; icon: string };

const NAV: NavItem[] = [
  { label: "Home", href: "/", icon: "H" },
  { label: "Matches", href: "/matches", icon: "M" },
  { label: "Clubs", href: "/clubs", icon: "C" },
  { label: "Profile", href: "/profile", icon: "P" },
];

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function titleFromPath(pathname: string) {
  const hit = NAV.find((n) => n.href === pathname);
  if (hit) return hit.label;
  if (pathname.startsWith("/matches")) return "Matches";
  if (pathname.startsWith("/clubs")) return "Clubs";
  if (pathname.startsWith("/profile")) return "Profile";
  return "Home";
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

  const authRoutes = ["/login", "/forgot-password", "/reset-password", "/logout"];
  const isAuthRoute = authRoutes.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );

  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const userEmail = (session?.user?.email ?? "").trim();
      setEmail(userEmail);
      setCheckedSession(true);

      if (!session?.user && !isAuthRoute) {
        router.replace("/login");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (!session?.user && !isAuthRoute) {
        router.replace("/login");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isAuthRoute, router]);

  const isAuthed = email.length > 0;

  if (isAuthRoute) {
    return <div className="min-h-screen bg-[var(--paper)]">{children}</div>;
  }

  if (!checkedSession) {
    return <div className="min-h-screen bg-[var(--paper)]" />;
  }

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[rgba(246,241,231,.18)] bg-[var(--pine)] text-[var(--paper)]">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="text-[11px] tracking-[0.28em] opacity-90">
              RECIPROCITY
            </Link>
            <div className="hidden text-sm opacity-80 sm:block">/ {pageTitle}</div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-sm opacity-85 md:block">
              {isAuthed ? (
                <>
                  Signed in as <span className="opacity-100">{email}</span>
                </>
              ) : (
                <span className="opacity-80">Not signed in</span>
              )}
            </div>

            {isAuthed ? (
              <>
                <Link
                  href={newMatchHref}
                  className="rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs font-medium text-[var(--pine)] shadow-[0_6px_18px_rgba(0,0,0,.18)] transition hover:-translate-y-[1px] sm:px-4 sm:py-2 sm:text-sm"
                >
                  New match
                </Link>

                <Link
                  href={logoutHref}
                  className="hidden rounded-full border border-[rgba(246,241,231,.28)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:bg-[rgba(246,241,231,.10)] sm:inline-flex"
                >
                  Logout
                </Link>
              </>
            ) : (
              <Link
                href={loginHref}
                className="rounded-full bg-[var(--paper)] px-3 py-1.5 text-xs font-medium text-[var(--pine)] shadow-[0_6px_18px_rgba(0,0,0,.18)] sm:px-4 sm:py-2 sm:text-sm"
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
            <div className="text-xs tracking-[0.22em] text-[var(--muted)]">MENU</div>
          </div>

          <nav className="space-y-1">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    "flex items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                    active
                      ? "bg-[rgba(11,59,46,.10)] text-[var(--pine)]"
                      : "text-[var(--ink)] hover:bg-[rgba(17,19,18,.05)]"
                  )}
                >
                  <span className="font-medium">{item.label}</span>
                  <span
                    className={cx(
                      "h-2 w-2 rounded-full",
                      active ? "bg-[var(--pine)]" : "bg-transparent"
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
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--border)] bg-[var(--paper-2)] pb-[env(safe-area-inset-bottom)] md:hidden">
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
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition",
                  active
                    ? "text-[var(--pine)]"
                    : "text-[var(--muted)]"
                )}
              >
                <span
                  className={cx(
                    "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold",
                    active
                      ? "bg-[rgba(11,59,46,.12)] text-[var(--pine)]"
                      : "text-[var(--muted)]"
                  )}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}

          {/* Logout in tab bar for mobile */}
          {isAuthed && (
            <Link
              href={logoutHref}
              className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-[var(--muted)] transition"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold">
                X
              </span>
              Logout
            </Link>
          )}
        </div>
      </nav>

      {/* Spacer so content isn't hidden behind bottom tab bar on mobile */}
      <div className="h-16 md:hidden" />
    </div>
  );
}
