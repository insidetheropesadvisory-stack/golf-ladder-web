"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/supabase";

type NavItem = { label: string; href: string };

const NAV: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Matches", href: "/matches" },
  { label: "Clubs", href: "/clubs" },
  { label: "Profile", href: "/profile" },
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
  const pageTitle = titleFromPath(pathname);

  const [email, setEmail] = useState((userEmail ?? "").trim());
  const [checkedSession, setCheckedSession] = useState(Boolean(userEmail));

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setEmail((session?.user?.email ?? "").trim());
      setCheckedSession(true);
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setEmail((session?.user?.email ?? "").trim());
      setCheckedSession(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const isAuthed = email.length > 0;

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <header className="sticky top-0 z-30 border-b border-[rgba(246,241,231,.18)] bg-[var(--pine)] text-[var(--paper)]">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-6">
          <div className="flex items-baseline gap-4">
            <div className="text-[11px] tracking-[0.28em] opacity-90">
              RECIPROCITY
            </div>
            <div className="hidden text-sm opacity-80 md:block">/ {pageTitle}</div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-sm opacity-85 md:block">
              {!checkedSession ? (
                <span className="opacity-80">Checking session…</span>
              ) : isAuthed ? (
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
                  className="rounded-full bg-[var(--paper)] px-4 py-2 text-sm font-medium text-[var(--pine)] shadow-[0_6px_18px_rgba(0,0,0,.18)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.22)]"
                >
                  New match
                </Link>

                <Link
                  href={logoutHref}
                  className="rounded-full border border-[rgba(246,241,231,.28)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:bg-[rgba(246,241,231,.10)]"
                >
                  Logout
                </Link>
              </>
            ) : (
              <Link
                href={loginHref}
                className="rounded-full bg-[var(--paper)] px-4 py-2 text-sm font-medium text-[var(--pine)] shadow-[0_6px_18px_rgba(0,0,0,.18)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.22)]"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[240px_1fr]">
        <aside className="h-fit rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-4 shadow-[var(--shadow)]">
          <div className="mb-4">
            <div className="text-xs tracking-[0.22em] text-[var(--muted)]">
              MENU
            </div>
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

        <main className="min-w-0">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-[var(--shadow)]">
            {children}
          </div>

          <footer className="mt-6 text-center text-xs text-[var(--muted)]">
            © {new Date().getFullYear()} Reciprocity • Private club competition,
            refined
          </footer>
        </main>
      </div>
    </div>
  );
}