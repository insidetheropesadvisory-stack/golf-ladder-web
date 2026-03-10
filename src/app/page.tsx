"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials, emailToName } from "@/lib/utils";

type MatchRow = {
  id: string;
  created_at: string;
  creator_id: string;
  opponent_id: string | null;
  opponent_email: string;
  course_name: string;
  completed: boolean;
  status: string | null;
  format: "stroke_play" | "match_play" | string;
  use_handicap: boolean;
  terms_status: "pending" | "accepted" | "denied" | string;
  terms_last_proposed_by: string | null;
  round_time: string | null;
  is_ladder_match: boolean;
};

type PlayerLite = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

type TournamentLite = {
  id: string;
  name: string;
  period_type: "weekly" | "monthly";
  period_count: number;
  start_date: string;
  end_date: string;
  status: string;
};

type LadderRank = {
  position: number;
  type: string;
};

const DEADLINE_MS = 12 * 60 * 60 * 1000;

function deriveBucket(r: MatchRow): "proposal" | "active" | "completed" {
  if (r.completed || r.status === "completed") return "completed";
  if (r.status === "expired") return "completed";
  const ts = String(r.terms_status ?? "").toLowerCase();
  if (ts === "accepted" || r.status === "active") return "active";
  if (ts === "pending" || ts === "denied") return "proposal";
  const s = String(r.status ?? "").toLowerCase();
  if (["proposed", "proposal", "pending", "invite", "invited"].includes(s)) return "proposal";
  if (["complete", "completed", "final", "finished", "closed"].includes(s)) return "completed";
  return "active";
}

function needsMyAction(r: MatchRow, meId: string) {
  if (r.completed) return false;
  const ts = String(r.terms_status ?? "").toLowerCase();
  if (ts === "denied") return r.creator_id === meId;
  if (ts === "pending") {
    if (r.terms_last_proposed_by) return r.terms_last_proposed_by !== meId;
    return r.creator_id !== meId;
  }
  return false;
}

function currentPeriod(t: TournamentLite): number {
  const now = new Date();
  const start = new Date(t.start_date + "T00:00:00");
  if (t.period_type === "weekly") {
    const diffMs = now.getTime() - start.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(Math.floor(diffDays / 7) + 1, t.period_count));
  } else {
    const months =
      (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth()) +
      1;
    return Math.max(1, Math.min(months, t.period_count));
  }
}

function countdownText(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return "Now";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function deadlineText(roundTime: string): string {
  const deadline = new Date(roundTime).getTime() + DEADLINE_MS;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return "Expired";
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m to score`;
  return `${mins}m to score`;
}

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Player");
  const [handicap, setHandicap] = useState<number | null>(null);
  const [hasName, setHasName] = useState(false);
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerLite>>({});
  const [clubMap, setClubMap] = useState<Record<string, string>>({});
  const [tournaments, setTournaments] = useState<TournamentLite[]>([]);
  const [ladderRanks, setLadderRanks] = useState<LadderRank[]>([]);

  useEffect(() => {
    let mounted = true;

    async function run(sessionUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }, authToken?: string) {
      try {
        if (!mounted) return;
        setLoading(true);
        setFatal(null);
        setMeId(sessionUser.id);

        const meta = (sessionUser.user_metadata ?? {}) as Record<string, unknown>;
        const metaName = String(meta.display_name ?? meta.name ?? "").trim();

        const { data: prof } = await supabase
          .from("profiles")
          .select("display_name, handicap_index")
          .eq("id", sessionUser.id)
          .maybeSingle();

        const nameRaw = String((prof as any)?.display_name ?? "").trim();
        if (mounted) {
          setDisplayName(nameRaw || metaName || "Player");
          setHasName(Boolean(nameRaw || metaName));
          setHandicap((prof as any)?.handicap_index ?? null);
        }

        // Fetch matches, tournaments, ladder in parallel
        const email = (sessionUser.email ?? "").trim();
        const orClause = [
          `creator_id.eq.${sessionUser.id}`,
          `opponent_id.eq.${sessionUser.id}`,
          email ? `opponent_email.ilike.${email}` : null,
        ].filter(Boolean).join(",");

        const [matchResult, tournamentResult, ladderResult, clubResult] = await Promise.all([
          supabase
            .from("matches")
            .select("id,created_at,creator_id,opponent_id,opponent_email,course_name,completed,status,format,use_handicap,terms_status,terms_last_proposed_by,round_time,is_ladder_match")
            .or(orClause)
            .order("created_at", { ascending: false }),
          // Tournaments: fetch via API
          (async () => {
            if (!authToken) return [];
            try {
              const res = await fetch("/api/tournaments", {
                headers: { Authorization: `Bearer ${authToken}` },
              });
              if (!res.ok) return [];
              const json = await res.json();
              return (json.tournaments ?? []).filter((t: any) => t.status === "active" && t.my_status === "accepted");
            } catch { return []; }
          })(),
          // Ladder position
          supabase
            .from("ladder_rankings")
            .select("position, type")
            .eq("user_id", sessionUser.id),
          // Clubs for name->id map
          supabase
            .from("clubs")
            .select("id, name")
            .limit(50),
        ]);

        if (matchResult.error) throw new Error(matchResult.error.message);
        const matchRows = (matchResult.data ?? []) as MatchRow[];
        if (!mounted) return;
        setRows(matchRows);
        setTournaments(tournamentResult as TournamentLite[]);
        setLadderRanks((ladderResult.data ?? []) as LadderRank[]);

        if (clubResult.data && mounted) {
          const map: Record<string, string> = {};
          for (const c of clubResult.data) {
            if (c.name && c.id) map[String(c.name).toLowerCase()] = c.id;
          }
          setClubMap(map);
        }

        // Fetch player profiles for opponents
        const ids = Array.from(
          new Set(
            matchRows
              .flatMap((r) => [r.creator_id, r.opponent_id].filter(Boolean) as string[])
              .filter((id) => id !== sessionUser.id)
          )
        );

        if (ids.length > 0) {
          const res = await fetch("/api/players/lookup", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({ ids }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.players && mounted) {
            setPlayers(json.players as Record<string, PlayerLite>);
          }
        }

        if (mounted) setLoading(false);
      } catch (e: any) {
        if (!mounted) return;
        setFatal(e?.message ?? "Unknown error");
        setLoading(false);
      }
    }

    let handled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      handled = true;
      if (session?.user) run(session.user, session.access_token);
      else { setFatal("Auth session missing"); setLoading(false); }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && mounted && session?.user) run(session.user, session.access_token);
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  function opponentFor(row: MatchRow) {
    const myId = meId ?? "";
    const oppId = myId === row.creator_id ? row.opponent_id : row.creator_id;
    const p = oppId ? players[String(oppId)] : null;
    const name = p?.display_name?.trim() || (myId === row.creator_id && !row.opponent_id ? "Invite pending" : emailToName(row.opponent_email || "Opponent"));
    return { name, avatarUrl: p?.avatar_url ?? null };
  }

  const buckets = useMemo(() => {
    const myId = meId ?? "";
    const proposed = rows.filter((r) => deriveBucket(r) === "proposal");
    const active = rows.filter((r) => deriveBucket(r) === "active");
    const completed = rows.filter((r) => deriveBucket(r) === "completed");
    const actionNeeded = proposed.filter((r) => needsMyAction(r, myId));

    const nextUp = [...active].sort((a, b) => {
      const ta = a.round_time ? new Date(a.round_time).getTime() : Infinity;
      const tb = b.round_time ? new Date(b.round_time).getTime() : Infinity;
      return ta - tb;
    });

    const recent = [...completed].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return { proposed, active: nextUp, completed: recent, actionNeeded };
  }, [rows, meId]);

  const grossRank = ladderRanks.find((r) => r.type === "gross");
  const netRank = ladderRanks.find((r) => r.type === "net");

  // Upcoming matches (sorted by round_time, future only)
  const upcoming = useMemo(() => {
    const now = Date.now();
    return buckets.active
      .filter((m) => m.round_time && new Date(m.round_time).getTime() > now)
      .sort((a, b) => new Date(a.round_time!).getTime() - new Date(b.round_time!).getTime())
      .slice(0, 3);
  }, [buckets.active]);

  // Active scoring window matches (round_time passed, within 12h)
  const scoringNow = useMemo(() => {
    const now = Date.now();
    return buckets.active.filter((m) => {
      if (!m.round_time) return false;
      const rt = new Date(m.round_time).getTime();
      return now >= rt && now <= rt + DEADLINE_MS;
    });
  }, [buckets.active]);

  const canCreateMatch = hasName;
  const newMatchHref = canCreateMatch ? "/matches/new" : "/profile?next=/matches/new&reason=name_required";

  // Build activity feed from recent matches + tournaments
  const activityFeed = useMemo(() => {
    const items: { id: string; type: "match_result" | "tournament" | "ladder"; text: string; subtext: string; href: string; time: number; icon: "trophy" | "medal" | "chart" }[] = [];

    // Recent completed matches (last 5)
    for (const m of buckets.completed.slice(0, 5)) {
      const opp = opponentFor(m);
      items.push({
        id: `m-${m.id}`,
        type: "match_result",
        text: `Match vs ${opp.name}`,
        subtext: `${m.course_name || "Course"} — ${m.format === "match_play" ? "Match Play" : "Stroke Play"}`,
        href: `/matches/${m.id}`,
        time: new Date(m.created_at).getTime(),
        icon: "trophy",
      });
    }

    // Active tournaments
    for (const t of tournaments) {
      const p = currentPeriod(t);
      const unit = t.period_type === "weekly" ? "Week" : "Month";
      items.push({
        id: `t-${t.id}`,
        type: "tournament",
        text: t.name,
        subtext: `${unit} ${p} of ${t.period_count}`,
        href: `/tournaments/${t.id}`,
        time: new Date(t.start_date).getTime(),
        icon: "medal",
      });
    }

    // Ladder position
    if (grossRank) {
      items.push({
        id: "ladder-gross",
        type: "ladder",
        text: `Ladder Position: #${grossRank.position}`,
        subtext: netRank ? `Net: #${netRank.position}` : "Gross ranking",
        href: "/ladder",
        time: Date.now(),
        icon: "chart",
      });
    }

    return items.sort((a, b) => b.time - a.time).slice(0, 8);
  }, [buckets.completed, tournaments, grossRank, netRank, players, meId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-[11px] tracking-[0.28em] text-[var(--muted)]">RECIPROCITY</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Welcome back{displayName !== "Player" ? `, ${displayName}` : ""}
        </h1>
        {handicap != null && (
          <div className="mt-0.5 text-xs text-[var(--muted)]">
            Handicap: <span className="font-semibold text-[var(--ink)]">{handicap}</span>
          </div>
        )}
      </div>

      {fatal && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div>{fatal}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
          >
            Reload page
          </button>
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {[
          { label: "Needs action", value: buckets.actionNeeded.length, href: "/matches" },
          { label: "Active matches", value: buckets.active.length, href: "/matches" },
          { label: "Tournaments", value: tournaments.length, href: "/tournaments" },
          { label: "Ladder rank", value: grossRank ? `#${grossRank.position}` : "—", href: "/ladder" },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-3 sm:p-4 shadow-[var(--shadow)] transition hover:-translate-y-[1px] hover:shadow-[0_14px_40px_rgba(17,19,18,.10)]"
          >
            <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--muted)] sm:text-[10px] sm:tracking-[0.2em]">{t.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--ink)] sm:text-2xl">{t.value}</div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Link
          href={newMatchHref}
          className="rounded-xl bg-[var(--pine)] px-3 py-2.5 text-center text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] sm:py-3"
        >
          New match
        </Link>
        <Link
          href="/matches/new?mode=link"
          className="rounded-xl border-2 border-[var(--pine)]/30 bg-[var(--pine)]/5 px-3 py-2.5 text-center text-sm font-semibold text-[var(--pine)] transition hover:-translate-y-[1px] hover:shadow-sm sm:py-3"
        >
          Invite friend
        </Link>
        <Link
          href="/tournaments/new"
          className="rounded-xl border-2 border-[var(--pine)]/30 bg-[var(--pine)]/5 px-3 py-2.5 text-center text-sm font-semibold text-[var(--pine)] transition hover:-translate-y-[1px] hover:shadow-sm sm:py-3"
        >
          New tournament
        </Link>
        <Link
          href="/ladder"
          className="rounded-xl border border-[var(--border)] bg-white/60 px-3 py-2.5 text-center text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-[1px] hover:shadow-sm sm:py-3"
        >
          View ladder
        </Link>
      </div>

      {/* Scoring now — matches in the 12h window */}
      {!loading && scoringNow.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Score now</h2>
          <div className="space-y-2">
            {scoringNow.map((m) => {
              const opp = opponentFor(m);
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group flex items-center gap-3 rounded-xl border-2 border-amber-200/60 bg-amber-50/30 p-3 transition hover:border-amber-300 hover:shadow-sm sm:p-4"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--ink)]">
                      vs {opp.name} — {m.course_name || "Course"}
                    </div>
                    <div className="mt-0.5 text-xs text-amber-700 font-medium">
                      {deadlineText(m.round_time!)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 border border-amber-200/60">
                    Enter scores
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Needs action */}
      {!loading && buckets.actionNeeded.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Needs action</h2>
          <div className="space-y-2">
            {buckets.actionNeeded.slice(0, 4).map((r) => {
              const opp = opponentFor(r);
              return (
                <Link
                  key={r.id}
                  href={`/matches/${r.id}`}
                  className="group flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-white/60 p-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm sm:gap-3 sm:p-4"
                >
                  <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white sm:h-10 sm:w-10">
                    {opp.avatarUrl ? (
                      <img src={opp.avatarUrl} alt={opp.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-[10px] font-semibold sm:text-xs">
                        {initials(opp.name)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{opp.name}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      {r.course_name} &middot; {r.format === "match_play" ? "Match Play" : "Stroke Play"}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[rgba(180,140,60,.16)] px-3 py-1 text-xs font-medium text-[rgba(120,82,18,.95)]">
                    Needs response
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Upcoming matches with countdown */}
      {!loading && upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Upcoming</h2>
          <div className="space-y-2">
            {upcoming.map((m) => {
              const opp = opponentFor(m);
              const dt = new Date(m.round_time!);
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 p-3 transition hover:border-blue-200 hover:shadow-sm sm:p-4"
                >
                  <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-blue-100 text-blue-700 sm:h-10 sm:w-10">
                    <div className="grid h-full w-full place-items-center text-[10px] font-bold sm:text-xs">
                      {dt.toLocaleDateString(undefined, { day: "numeric" })}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--ink)]">
                      vs {opp.name}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      {m.course_name} &middot; {dt.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold text-blue-700 tabular-nums">{countdownText(m.round_time!)}</div>
                    <div className="text-[10px] text-[var(--muted)]">until tee time</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Active tournaments */}
      {!loading && tournaments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Your tournaments</h2>
          <div className="space-y-2">
            {tournaments.slice(0, 3).map((t) => {
              const p = currentPeriod(t);
              const unit = t.period_type === "weekly" ? "Week" : "Month";
              return (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 p-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm sm:p-4"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[var(--pine)]">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <circle cx="12" cy="8" r="6" />
                      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--pine)] transition-colors">{t.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted)]">
                      {unit} {p} of {t.period_count}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 border border-emerald-200/60">
                    {unit} {p}
                  </span>
                </Link>
              );
            })}
            {tournaments.length > 3 && (
              <Link href="/tournaments" className="block text-center text-xs font-medium text-[var(--pine)]">
                View all {tournaments.length} tournaments →
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Next up — active matches without specific time */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Active matches</h2>
        {loading ? (
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-xl bg-black/[0.03]" />
            <div className="h-16 animate-pulse rounded-xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
          </div>
        ) : buckets.active.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4 text-sm text-[var(--muted)]">
            No active matches.{" "}
            <Link href={newMatchHref} className="font-medium text-[var(--pine)] underline">
              Create one
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {buckets.active.slice(0, 4).map((r) => {
              const opp = opponentFor(r);
              return (
                <Link
                  key={r.id}
                  href={`/matches/${r.id}`}
                  className="group flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-white/60 p-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm sm:gap-3 sm:p-4"
                >
                  <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white sm:h-10 sm:w-10">
                    {opp.avatarUrl ? (
                      <img src={opp.avatarUrl} alt={opp.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-[10px] font-semibold sm:text-xs">
                        {initials(opp.name)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{opp.name}</span>
                      {r.is_ladder_match && (
                        <span className="hidden rounded-full bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 sm:inline">Ladder</span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      {r.course_name} &middot; {r.format === "match_play" ? "Match Play" : "Stroke Play"}{r.use_handicap ? " (Net)" : ""}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[rgba(11,59,46,.12)] px-3 py-1 text-xs font-medium text-[var(--pine)]">Active</span>
                </Link>
              );
            })}
            {buckets.active.length > 4 && (
              <Link href="/matches" className="block text-center text-xs font-medium text-[var(--pine)]">
                View all {buckets.active.length} active matches →
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Activity feed */}
      {!loading && activityFeed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Recent activity</h2>
          <div className="rounded-2xl border border-[var(--border)] bg-white/60 divide-y divide-[var(--border)]">
            {activityFeed.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-black/[0.02] first:rounded-t-2xl last:rounded-b-2xl"
              >
                <div className={cx(
                  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
                  item.icon === "trophy" && "bg-emerald-100 text-emerald-600",
                  item.icon === "medal" && "bg-[var(--pine)]/10 text-[var(--pine)]",
                  item.icon === "chart" && "bg-blue-100 text-blue-600",
                )}>
                  {item.icon === "trophy" && (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 19.24 7 20v2M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 19.24 17 20v2M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                    </svg>
                  )}
                  {item.icon === "medal" && (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <circle cx="12" cy="8" r="6" />
                      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
                    </svg>
                  )}
                  {item.icon === "chart" && (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20V10M18 20V4M6 20v-4" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--ink)]">{item.text}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{item.subtext}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
