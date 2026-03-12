"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials, emailToName } from "@/lib/utils";
import BadgeRow from "@/app/components/BadgeRow";

type AnyRow = Record<string, any>;

const DEADLINE_MS = 12 * 60 * 60 * 1000; // 12 hours

function formatLabel(format?: string) {
  if (format === "match_play") return "Match Play";
  return "Stroke Play";
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "active" | "proposed" | "done" | "upcoming";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-gray-100 text-gray-600 border-gray-200/60",
    active: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    proposed: "bg-amber-50 text-amber-700 border-amber-200/60",
    done: "bg-slate-100 text-slate-600 border-slate-200/60",
    upcoming: "bg-blue-50 text-blue-700 border-blue-200/60",
  };

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:px-2.5 sm:text-[11px]",
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

/** Compute time-aware match display bucket */
function matchBucket(m: AnyRow): "upcoming" | "active" | "proposed" | "completed" | "expired" {
  if (Boolean(m.completed) || m.status === "completed") return "completed";
  if (m.status === "expired") return "expired";
  if (m.status === "proposed" || m.terms_status === "pending") return "proposed";

  // Active match — check round_time for upcoming vs active vs expired
  if (m.round_time) {
    const now = Date.now();
    const roundTime = new Date(m.round_time).getTime();
    const deadline = roundTime + DEADLINE_MS;

    if (now < roundTime) return "upcoming";
    if (now > deadline) return "expired"; // Will be resolved by the API
    return "active";
  }

  // No round_time set — always "active"
  return "active";
}

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function deadlineLabel(roundTime: string) {
  const deadline = new Date(roundTime).getTime() + DEADLINE_MS;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return "Expired";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
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
  const [filterStatus, setFilterStatus] = useState<"all" | "upcoming" | "active" | "proposed" | "completed">("all");
  const [myHoleCounts, setMyHoleCounts] = useState<Record<string, number>>({});
  const [clubMap, setClubMap] = useState<Record<string, string>>({});
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [handicaps, setHandicaps] = useState<Record<string, number>>({});
  const [hasMoreCompleted, setHasMoreCompleted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const PAGE_SIZE = 20;

  const loadPage = useCallback(async (sessionUser: { id: string; email?: string | null }) => {
    try {
      setLoading(true);
      setStatus(null);
      setSignedOut(false);
      setMe({ id: sessionUser.id, email: sessionUser.email ?? null });

      // Fire-and-forget: resolve expired matches & send reminders
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) {
          fetch("/api/matches/resolve", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
          }).catch(() => {});
        }
      });

      // Load active/proposed/upcoming matches (all of them)
      const { data: activeData, error: activeErr } = await supabase
        .from("matches")
        .select("*")
        .eq("completed", false)
        .neq("status", "completed")
        .order("created_at", { ascending: false });

      if (activeErr) {
        setStatus(activeErr.message);
        setLoading(false);
        return;
      }

      // Load completed matches with pagination
      const { data: completedData, error: completedErr } = await supabase
        .from("matches")
        .select("*")
        .or("completed.eq.true,status.eq.completed")
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (completedErr) {
        setStatus(completedErr.message);
        setLoading(false);
        return;
      }

      const m = [...(activeData ?? []), ...(completedData ?? [])] as AnyRow[];
      setMatches(m);
      setHasMoreCompleted((completedData ?? []).length >= PAGE_SIZE);

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

      // Fetch display names and handicaps for all players
      const playerIds = new Set<string>();
      playerIds.add(sessionUser.id);
      for (const row of m) {
        if (row.creator_id) playerIds.add(row.creator_id);
        if (row.opponent_id) playerIds.add(row.opponent_id);
      }
      if (playerIds.size > 0) {
        const { data: profData } = await supabase
          .from("profiles")
          .select("id, display_name, handicap_index")
          .in("id", [...playerIds]);
        if (profData) {
          const names: Record<string, string> = {};
          const hcps: Record<string, number> = {};
          for (const p of profData as any[]) {
            if (p.display_name) names[p.id] = p.display_name;
            if (typeof p.handicap_index === "number") hcps[p.id] = p.handicap_index;
          }
          setDisplayNames(names);
          setHandicaps(hcps);
        }
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

  async function loadMoreCompleted() {
    if (!me || loadingMore) return;
    setLoadingMore(true);
    try {
      const currentCompleted = matches.filter(
        (m) => Boolean(m.completed) || m.status === "completed"
      );
      const offset = currentCompleted.length;

      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .or("completed.eq.true,status.eq.completed")
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        setStatus(error.message);
        setLoadingMore(false);
        return;
      }

      const newRows = (data ?? []) as AnyRow[];
      setMatches((prev) => [...prev, ...newRows]);
      setHasMoreCompleted(newRows.length >= PAGE_SIZE);

      // Fetch display names and handicaps for new players
      const newPlayerIds = new Set<string>();
      for (const row of newRows) {
        if (row.creator_id && !displayNames[row.creator_id]) newPlayerIds.add(row.creator_id);
        if (row.opponent_id && !displayNames[row.opponent_id]) newPlayerIds.add(row.opponent_id);
      }
      if (newPlayerIds.size > 0) {
        const { data: profData } = await supabase
          .from("profiles")
          .select("id, display_name, handicap_index")
          .in("id", [...newPlayerIds]);
        if (profData) {
          setDisplayNames((prev) => {
            const next = { ...prev };
            for (const p of profData as any[]) {
              if (p.display_name) next[p.id] = p.display_name;
            }
            return next;
          });
          setHandicaps((prev) => {
            const next = { ...prev };
            for (const p of profData as any[]) {
              if (typeof p.handicap_index === "number") next[p.id] = p.handicap_index;
            }
            return next;
          });
        }
      }

      // Fetch hole counts for new matches
      const newIds = newRows.map((r) => r.id).filter(Boolean);
      if (newIds.length > 0) {
        const { data: holeData } = await supabase
          .from("holes")
          .select("match_id, hole_no, strokes, player_id")
          .in("match_id", newIds)
          .eq("player_id", me.id);
        if (holeData) {
          setMyHoleCounts((prev) => {
            const next = { ...prev };
            for (const r of holeData as AnyRow[]) {
              if (r.match_id && typeof r.strokes === "number") {
                next[r.match_id] = (next[r.match_id] ?? 0) + 1;
              }
            }
            return next;
          });
        }
      }
    } catch (e: any) {
      setStatus(e?.message || "Failed to load more");
    }
    setLoadingMore(false);
  }

  function opponentName(m: AnyRow) {
    const oppId = me?.id === m.creator_id ? m.opponent_id : m.creator_id;
    if (oppId && displayNames[oppId]) return displayNames[oppId];
    return emailToName(String(m.opponent_email ?? ""));
  }

  function opponentId(m: AnyRow): string | null {
    const oppId = me?.id === m.creator_id ? m.opponent_id : m.creator_id;
    return oppId ?? null;
  }

  function handicapLabel(m: AnyRow) {
    if (!m.use_handicap) return null;
    const myHcp = me?.id ? handicaps[me.id] : undefined;
    const oppId = me?.id === m.creator_id ? m.opponent_id : m.creator_id;
    const oppHcp = oppId ? handicaps[oppId] : undefined;
    if (myHcp == null && oppHcp == null) return null;
    const myStr = myHcp != null ? myHcp.toFixed(1) : "–";
    const oppStr = oppHcp != null ? oppHcp.toFixed(1) : "–";
    return `${myStr} vs ${oppStr}`;
  }

  function matchText(m: AnyRow) {
    return [
      opponentName(m),
      m.opponent_email ?? "",
      m.course_name ?? "",
      m.round_time ? new Date(m.round_time).toLocaleDateString() : "",
    ].join(" ").toLowerCase();
  }

  const { proposed, upcoming, active, completed } = useMemo(() => {
    const proposed: AnyRow[] = [];
    const upcoming: AnyRow[] = [];
    const active: AnyRow[] = [];
    const completed: AnyRow[] = [];

    const q = query.trim().toLowerCase();

    for (const m of matches) {
      if (q && !matchText(m).includes(q)) continue;

      const bucket = matchBucket(m);
      if (bucket === "completed") completed.push(m);
      else if (bucket === "proposed") proposed.push(m);
      else if (bucket === "upcoming") upcoming.push(m);
      else if (bucket === "active") active.push(m);
      // "expired" matches are hidden from UX
    }

    // Sort upcoming by round_time ascending (soonest first)
    upcoming.sort((a, b) => {
      const ta = a.round_time ? new Date(a.round_time).getTime() : 0;
      const tb = b.round_time ? new Date(b.round_time).getTime() : 0;
      return ta - tb;
    });

    return { proposed, upcoming, active, completed };
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

  const showUpcoming = filterStatus === "all" || filterStatus === "upcoming";
  const showActive = filterStatus === "all" || filterStatus === "active";
  const showProposedSection = filterStatus === "all" || filterStatus === "proposed";
  const showCompleted = filterStatus === "all" || filterStatus === "completed";

  const filterTabs: { key: typeof filterStatus; label: string; count: number }[] = [
    { key: "all", label: "All", count: upcoming.length + active.length + proposed.length + completed.length },
    { key: "active", label: "Active", count: active.length },
    { key: "proposed", label: "Proposed", count: proposed.length },
    { key: "upcoming", label: "Upcoming", count: upcoming.length },
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

      {/* Active matches */}
      {showActive && active.length === 0 && filterStatus === "active" && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No active matches right now</div>
          <p className="mt-1 text-xs text-[var(--muted)]">Matches appear here once scoring begins.</p>
        </div>
      )}
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
                        <span className="truncate">vs {opponentName(m)}</span>
                        {opponentId(m) && <BadgeRow userId={opponentId(m)!} />}
                        <span className="text-[var(--border)]">/</span>
                        <span>{formatLabel(m.format)}</span>
                        {handicapLabel(m) && (
                          <>
                            <span className="text-[var(--border)]">/</span>
                            <span className="font-medium text-amber-700">HCP {handicapLabel(m)}</span>
                          </>
                        )}
                        {holesPlayed > 0 && (
                          <>
                            <span className="text-[var(--border)]">/</span>
                            <span className="font-medium text-emerald-700">{holesPlayed}/18</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="rounded-[3px] bg-[var(--pine)] px-3 py-1.5 text-[11px] font-bold text-white">
                        Start your match
                      </span>
                      {m.round_time && (
                        <span className="text-[10px] font-medium text-amber-600">{deadlineLabel(m.round_time)}</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Proposed */}
      {showProposedSection && proposed.length === 0 && filterStatus === "proposed" && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No pending proposals</div>
          <p className="mt-1 text-xs text-[var(--muted)]">Challenges you send or receive will show up here.</p>
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
                  className="group block rounded-xl border border-[var(--border)] bg-white/70 p-3 transition hover:border-amber-200 hover:shadow-md sm:rounded-2xl sm:p-4"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold tracking-tight sm:text-sm">
                        <ClubName name={m.course_name ?? "Course"} clubMap={clubMap} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--muted)] sm:text-xs">
                        <span className="truncate">vs {opponentName(m)}</span>
                        {opponentId(m) && <BadgeRow userId={opponentId(m)!} />}
                        <span className="text-[var(--border)]">&middot;</span>
                        <span>{formatLabel(m.format)}</span>
                        {handicapLabel(m) && (
                          <>
                            <span className="text-[var(--border)]">&middot;</span>
                            <span className="font-medium text-amber-700">HCP {handicapLabel(m)}</span>
                          </>
                        )}
                        {m.round_time && (
                          <>
                            <span className="text-[var(--border)]">&middot;</span>
                            <span className="font-medium text-amber-600">{formatDateTime(m.round_time)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {isCreator ? (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteMatch(m.id); }}
                        disabled={deleting === m.id}
                        className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-100 hover:border-red-300 disabled:opacity-50"
                      >
                        {deleting === m.id ? "..." : "Delete"}
                      </button>
                    ) : (
                      <Badge tone="proposed">Review</Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming matches */}
      {showUpcoming && upcoming.length === 0 && filterStatus === "upcoming" && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No upcoming matches scheduled</div>
          <p className="mt-1 text-xs text-[var(--muted)]">Accepted matches with a future tee time appear here.</p>
        </div>
      )}
      {showUpcoming && upcoming.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Upcoming</div>
            <Badge tone="upcoming">{upcoming.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="group rounded-2xl border border-[var(--border)] bg-white/70 p-3 transition hover:border-blue-200 hover:shadow-md sm:p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold tracking-tight group-hover:text-blue-800 transition-colors">
                      <ClubName name={m.course_name ?? "Course"} clubMap={clubMap} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--muted)]">
                      <span className="truncate">vs {opponentName(m)}</span>
                        {opponentId(m) && <BadgeRow userId={opponentId(m)!} />}
                      <span className="text-[var(--border)]">/</span>
                      <span>{formatLabel(m.format)}</span>
                      {handicapLabel(m) && (
                        <>
                          <span className="text-[var(--border)]">/</span>
                          <span className="font-medium text-amber-700">HCP {handicapLabel(m)}</span>
                        </>
                      )}
                      {m.round_time && (
                        <>
                          <span className="text-[var(--border)]">/</span>
                          <span className="font-medium text-blue-600">{formatDateTime(m.round_time)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <Badge tone="upcoming">Scheduled</Badge>
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

      {/* Completed */}
      {showCompleted && completed.length === 0 && filterStatus === "completed" && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">No completed matches yet</div>
          <p className="mt-1 text-xs text-[var(--muted)]">Finished matches and scorecards will appear here.</p>
        </div>
      )}
      {showCompleted && completed.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-3 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">Completed</div>
            <Badge tone="done">{completed.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
            {completed.map((m) => (
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
                      <span className="truncate">vs {opponentName(m)}</span>
                        {opponentId(m) && <BadgeRow userId={opponentId(m)!} />}
                      {handicapLabel(m) && (
                        <>
                          <span className="text-[var(--border)]">/</span>
                          <span className="font-medium text-amber-700">HCP {handicapLabel(m)}</span>
                        </>
                      )}
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
          {hasMoreCompleted && (
            <button
              type="button"
              onClick={loadMoreCompleted}
              disabled={loadingMore}
              className="mt-3 w-full rounded-xl border border-[var(--border)] bg-white/60 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)] hover:border-[var(--pine)]/20 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more matches"}
            </button>
          )}
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
