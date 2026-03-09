"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";

type AnyRow = Record<string, any>;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function emailToName(email: string) {
  const base = (email || "").split("@")[0] || "Opponent";
  return base.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatLabel(format?: string) {
  if (format === "match_play") return "Match Play";
  return "Stroke Play";
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "active" | "proposed" | "done";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-gray-100 text-gray-600 border-gray-200/60",
    active: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    proposed: "bg-amber-50 text-amber-700 border-amber-200/60",
    done: "bg-slate-100 text-slate-600 border-slate-200/60",
  };

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export default function MatchesPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const [me, setMe] = useState<{ id: string; email: string | null } | null>(null);
  const [matches, setMatches] = useState<AnyRow[]>([]);
  const [clubs, setClubs] = useState<AnyRow[]>([]);
  const [showProposed, setShowProposed] = useState(false);
  const [query, setQuery] = useState("");
  const [myHoleCounts, setMyHoleCounts] = useState<Record<string, number>>({});

  const loadPage = useCallback(async (sessionUser: { id: string; email?: string | null }) => {
    try {
      setLoading(true);
      setStatus(null);
      setSignedOut(false);
      setMe({ id: sessionUser.id, email: sessionUser.email ?? null });

      const { data: matchData, error: matchErr } = await supabase
        .from("matches")
        .select("*")
        .order("created_at", { ascending: false });

      if (matchErr) {
        setStatus(matchErr.message);
        setLoading(false);
        return;
      }

      const m = (matchData ?? []) as AnyRow[];
      setMatches(m);

      const { data: clubData, error: clubErr } = await supabase
        .from("clubs")
        .select("*")
        .limit(12);

      if (!clubErr && clubData) {
        setClubs(clubData as AnyRow[]);
      } else if (clubErr) {
        console.warn("clubs load error:", clubErr.message);
      }

      const ids = m.map((row) => row.id).filter(Boolean);

      if (ids.length > 0) {
        const { data: holeData, error: holeErr } = await supabase
          .from("holes")
          .select("match_id, hole_no, strokes, player_id")
          .in("match_id", ids)
          .eq("player_id", sessionUser.id);

        if (!holeErr && holeData) {
          const counts: Record<string, number> = {};
          for (const r of holeData as AnyRow[]) {
            if (r.match_id && typeof r.strokes === "number") {
              counts[r.match_id] = (counts[r.match_id] ?? 0) + 1;
            }
          }
          setMyHoleCounts(counts);
        } else if (holeErr) {
          console.warn("hole progress load error:", holeErr.message);
        }
      } else {
        setMyHoleCounts({});
      }

      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to load matches");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let handled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      if (session?.user) {
        loadPage(session.user);
      } else {
        setSignedOut(true);
        setMe(null);
        setMatches([]);
        setClubs([]);
        setMyHoleCounts({});
        setLoading(false);
      }
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && session?.user) {
        loadPage(session.user);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadPage]);

  const [deleting, setDeleting] = useState<string | null>(null);

  async function deleteMatch(matchId: string) {
    if (!confirm("Delete this proposed match?")) return;

    setDeleting(matchId);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ matchId }),
      });

      const json = await res.json();
      setDeleting(null);

      if (!res.ok) {
        setStatus(json.error || "Failed to delete match");
        return;
      }

      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    } catch (e: any) {
      setDeleting(null);
      setStatus(e?.message || "Failed to delete match");
    }
  }

  const { proposed, active, completed } = useMemo(() => {
    const proposed: AnyRow[] = [];
    const completed: AnyRow[] = [];
    const active: AnyRow[] = [];

    for (const m of matches) {
      const isCompleted = Boolean(m.completed) || m.status === "completed";
      const isProposed = m.status === "proposed" || m.terms_status === "pending";

      if (isCompleted) completed.push(m);
      else if (isProposed) proposed.push(m);
      else active.push(m);
    }

    return { proposed, active, completed };
  }, [matches]);

  const filteredActive = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;

    return active.filter((m) => {
      const opponent = String(m.opponent_email ?? "").toLowerCase();
      const course = String(m.course_name ?? "").toLowerCase();
      const status = String(m.status ?? "").toLowerCase();
      return opponent.includes(q) || course.includes(q) || status.includes(q);
    });
  }, [active, query]);

  const stats = useMemo(
    () => [
      { label: "Active", value: active.length, color: "from-emerald-500/10 to-emerald-500/5 border-emerald-200/40", accent: "text-emerald-700" },
      { label: "Proposed", value: proposed.length, color: "from-amber-500/10 to-amber-500/5 border-amber-200/40", accent: "text-amber-700" },
      { label: "Completed", value: completed.length, color: "from-slate-500/10 to-slate-500/5 border-slate-200/40", accent: "text-slate-600" },
    ],
    [active.length, proposed.length, completed.length]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" />
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (signedOut) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-gradient-to-b from-white to-[var(--paper)] p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--pine)]/10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--pine)]">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">
            Sign in to continue
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            View your matches, clubs, and scoring progress.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center rounded-xl bg-[var(--pine)] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className={cx(
              "rounded-2xl border bg-gradient-to-br p-5 transition-shadow hover:shadow-sm",
              s.color
            )}
          >
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
              {s.label}
            </div>
            <div className={cx("mt-1.5 text-3xl font-bold tracking-tight", s.accent)}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {active.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Active Matches</div>
            <Badge tone="active">{active.length}</Badge>
          </div>

          {active.length > 4 && (
            <div className="mt-3">
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)] transition"
                placeholder="Search active matches..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}

          <div className="mt-4 grid gap-3">
            {filteredActive.map((m) => {
              const holesPlayed = myHoleCounts[m.id] ?? 0;
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group rounded-2xl border border-[var(--border)] bg-white/70 p-4 transition hover:border-emerald-200 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold tracking-tight group-hover:text-emerald-800 transition-colors">
                        {m.course_name ?? "Course"}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted)]">
                        <span>vs {emailToName(String(m.opponent_email ?? ""))}</span>
                        <span className="text-[var(--border)]">/</span>
                        <span>{formatLabel(m.format)}</span>
                        {holesPlayed > 0 && (
                          <>
                            <span className="text-[var(--border)]">/</span>
                            <span className="font-medium text-emerald-700">{holesPlayed}/18 holes</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Badge tone="active">Active</Badge>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
                        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {proposed.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Proposed</div>
            <Badge tone="proposed">{proposed.length}</Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {proposed.map((m) => {
              const isCreator = me?.id === m.creator_id;
              return (
                <div
                  key={m.id}
                  className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/70 p-4 transition hover:border-amber-200 hover:shadow-md"
                >
                  <Link href={`/matches/${m.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold tracking-tight">
                          {m.course_name ?? "Course"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-x-2 text-xs text-[var(--muted)]">
                          <span>vs {emailToName(String(m.opponent_email ?? ""))}</span>
                          <span className="text-[var(--border)]">/</span>
                          <span>{formatLabel(m.format)}</span>
                        </div>
                      </div>
                      <Badge tone="proposed">Proposed</Badge>
                    </div>
                  </Link>
                  {isCreator && (
                    <button
                      type="button"
                      onClick={() => deleteMatch(m.id)}
                      disabled={deleting === m.id}
                      className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 hover:border-red-300 disabled:opacity-50"
                    >
                      {deleting === m.id ? "..." : "Delete"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Completed</div>
            <Badge tone="done">{completed.length}</Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {completed.slice(0, 6).map((m) => (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="group rounded-2xl border border-[var(--border)] bg-white/70 p-4 transition hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold tracking-tight">
                      {m.course_name ?? "Course"}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--muted)]">
                      vs {emailToName(String(m.opponent_email ?? ""))}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <Badge tone="done">Done</Badge>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {matches.length === 0 && !status && (
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-gradient-to-b from-white to-[var(--paper)] p-10 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <div className="text-base font-semibold tracking-tight">No matches yet</div>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              Create your first match to get started.
            </p>
            <Link
              href="/matches/new"
              className="mt-6 inline-flex items-center rounded-xl bg-[var(--pine)] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
            >
              New match
            </Link>
          </div>
        </div>
      )}

      {status ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {status}
        </div>
      ) : null}
    </div>
  );
  }
