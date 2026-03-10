"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials, emailToName } from "@/lib/utils";

type AnyRow = Record<string, any>;

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

function ClubName({ name, clubMap }: { name: string; clubMap: Record<string, string> }) {
  const router = useRouter();
  const cid = clubMap[name.toLowerCase()];
  if (!cid) return <>{name}</>;
  return (
    <span
      role="link"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/clubs/${cid}`); }}
      className="underline decoration-[var(--pine)]/30 hover:decoration-[var(--pine)] hover:text-[var(--pine)] cursor-pointer transition"
    >
      {name}
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
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "proposed" | "completed">("all");
  const [myHoleCounts, setMyHoleCounts] = useState<Record<string, number>>({});
  const [clubMap, setClubMap] = useState<Record<string, string>>({});

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
        const map: Record<string, string> = {};
        for (const c of clubData) {
          if (c.name && c.id) map[String(c.name).toLowerCase()] = c.id;
        }
        setClubMap(map);
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

  function matchBucket(m: AnyRow): "active" | "proposed" | "completed" {
    if (Boolean(m.completed) || m.status === "completed") return "completed";
    if (m.status === "proposed" || m.terms_status === "pending") return "proposed";
    return "active";
  }

  function matchText(m: AnyRow) {
    return [
      m.opponent_email ?? "",
      m.course_name ?? "",
      m.round_time ? new Date(m.round_time).toLocaleDateString() : "",
    ].join(" ").toLowerCase();
  }

  const { proposed, active, completed } = useMemo(() => {
    const proposed: AnyRow[] = [];
    const completed: AnyRow[] = [];
    const active: AnyRow[] = [];

    const q = query.trim().toLowerCase();

    for (const m of matches) {
      // Text filter
      if (q && !matchText(m).includes(q)) continue;

      const bucket = matchBucket(m);
      if (bucket === "completed") completed.push(m);
      else if (bucket === "proposed") proposed.push(m);
      else active.push(m);
    }

    return { proposed, active, completed };
  }, [matches, query]);


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

  const showActive = filterStatus === "all" || filterStatus === "active";
  const showProposedSection = filterStatus === "all" || filterStatus === "proposed";
  const showCompleted = filterStatus === "all" || filterStatus === "completed";

  const filterTabs: { key: typeof filterStatus; label: string; count: number }[] = [
    { key: "all", label: "All", count: active.length + proposed.length + completed.length },
    { key: "active", label: "Active", count: active.length },
    { key: "proposed", label: "Proposed", count: proposed.length },
    { key: "completed", label: "Completed", count: completed.length },
  ];

  return (
    <div className="space-y-6">
      {/* Search + filter bar */}
      <div className="space-y-3">
        <input
          className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)] transition"
          placeholder="Search by opponent, course, or date..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilterStatus(t.key)}
              className={cx(
                "rounded-full px-2.5 py-1.5 text-xs font-medium transition",
                filterStatus === t.key
                  ? "bg-[var(--pine)] text-white"
                  : "bg-black/[0.04] text-[var(--muted)] hover:bg-black/[0.07]"
              )}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
      </div>

      {showActive && active.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Active Matches</div>
            <Badge tone="active">{active.length}</Badge>
          </div>

          <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
            {active.map((m) => {
              const holesPlayed = myHoleCounts[m.id] ?? 0;
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group rounded-2xl border border-[var(--border)] bg-white/70 p-3 transition hover:border-emerald-200 hover:shadow-md sm:p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold tracking-tight group-hover:text-emerald-800 transition-colors">
                        <ClubName name={m.course_name ?? "Course"} clubMap={clubMap} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--muted)]">
                        <span className="truncate">vs {emailToName(String(m.opponent_email ?? ""))}</span>
                        <span className="text-[var(--border)]">/</span>
                        <span>{formatLabel(m.format)}</span>
                        {holesPlayed > 0 && (
                          <>
                            <span className="text-[var(--border)]">/</span>
                            <span className="font-medium text-emerald-700">{holesPlayed}/18</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Badge tone="active">Active</Badge>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="hidden text-[var(--muted)] sm:block opacity-0 transition group-hover:opacity-100">
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

      {showProposedSection && proposed.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Proposed</div>
            <Badge tone="proposed">{proposed.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
            {proposed.map((m) => {
              const isCreator = me?.id === m.creator_id;
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group block rounded-2xl border border-[var(--border)] bg-white/70 p-4 transition hover:border-amber-200 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold tracking-tight">
                        <ClubName name={m.course_name ?? "Course"} clubMap={clubMap} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted)]">
                        <span className="truncate">vs {emailToName(String(m.opponent_email ?? ""))}</span>
                        <span className="text-[var(--border)]">/</span>
                        <span>{formatLabel(m.format)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone="proposed">Proposed</Badge>
                      {isCreator && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteMatch(m.id); }}
                          disabled={deleting === m.id}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100 hover:border-red-300 disabled:opacity-50"
                        >
                          {deleting === m.id ? "..." : "Delete"}
                        </button>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {showCompleted && completed.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Completed</div>
            <Badge tone="done">{completed.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
            {(filterStatus === "completed" ? completed : completed.slice(0, 6)).map((m) => (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="group rounded-2xl border border-[var(--border)] bg-white/70 p-3 sm:p-4 transition hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold tracking-tight">
                      <ClubName name={m.course_name ?? "Course"} clubMap={clubMap} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted)]">
                      <span className="truncate">vs {emailToName(String(m.opponent_email ?? ""))}</span>
                      {m.round_time && (
                        <>
                          <span className="text-[var(--border)]">/</span>
                          <span>{new Date(m.round_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <Badge tone="done">Done</Badge>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="hidden text-[var(--muted)] sm:block opacity-0 transition group-hover:opacity-100">
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
          <div>{status}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
          >
            Reload page
          </button>
        </div>
      ) : null}
    </div>
  );
  }
