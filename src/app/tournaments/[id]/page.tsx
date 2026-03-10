"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type Tournament = {
  id: string;
  name: string;
  description: string | null;
  creator_id: string;
  period_type: "weekly" | "monthly";
  period_count: number;
  start_date: string;
  end_date: string;
  status: string;
};

type Standing = {
  user_id: string;
  rounds_played: number;
  periods_played: number;
  avg_differential: number | null;
  period_scores: Record<number, { round_id: string; differential: number; gross_score: number; course_name: string }>;
};

type PeriodEntry = {
  user_id: string;
  round_id: string;
  differential: number;
  gross_score: number;
  course_name: string;
};

type RoundRow = {
  id: string;
  user_id: string;
  period_number: number;
  completed: boolean;
  course_name: string;
};

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

/** Compute position trend by comparing current avg-diff ranking to what it was one period ago. */
function computeTrends(
  standings: Standing[],
  currentPeriod: number
): Record<string, number> {
  const trends: Record<string, number> = {};
  if (currentPeriod <= 1) return trends;

  // Recompute standings as of last period (exclude current period scores)
  const prevStandings = standings
    .map((s) => {
      const prevScores = Object.entries(s.period_scores)
        .filter(([p]) => Number(p) < currentPeriod)
        .map(([, v]) => v.differential);
      const avg = prevScores.length > 0
        ? prevScores.reduce((a, b) => a + b, 0) / prevScores.length
        : null;
      return { user_id: s.user_id, avg };
    })
    .sort((a, b) => {
      if (a.avg == null && b.avg == null) return 0;
      if (a.avg == null) return 1;
      if (b.avg == null) return -1;
      return a.avg - b.avg;
    });

  const prevPositions: Record<string, number> = {};
  prevStandings.forEach((s, i) => {
    prevPositions[s.user_id] = i + 1;
  });

  standings.forEach((s, i) => {
    const currentPos = i + 1;
    const prevPos = prevPositions[s.user_id];
    if (prevPos != null) {
      // Positive = improved (moved up), negative = dropped
      trends[s.user_id] = prevPos - currentPos;
    }
  });

  return trends;
}

function TrendArrow({ change }: { change: number | undefined }) {
  if (change == null || change === 0) return null;
  if (change > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
          <path d="M6 9V3m0 0L3 6m3-3l3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {change}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-red-500">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
        <path d="M6 3v6m0 0l3-3m-3 3L3 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {Math.abs(change)}
    </span>
  );
}

export default function TournamentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [standings, setStandings] = useState<Standing[]>([]);
  const [periodLeaderboards, setPeriodLeaderboards] = useState<Record<number, PeriodEntry[]>>({});
  const [currentPeriod, setCurrentPeriod] = useState(1);
  const [meId, setMeId] = useState<string | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [startingTournament, setStartingTournament] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [viewPeriod, setViewPeriod] = useState<"overall" | number>("overall");
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError("Not signed in"); setLoading(false); return; }

      setMeId(session.user.id);

      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to load tournament");
      }

      const json = await res.json();
      setTournament(json.tournament);
      setProfiles(json.profiles ?? {});
      setStandings(json.standings ?? []);
      setPeriodLeaderboards(json.periodLeaderboards ?? {});
      setCurrentPeriod(json.currentPeriod ?? 1);
      setIsCreator(json.tournament?.creator_id === session.user.id);
      setRounds(json.rounds ?? []);
      setParticipants(json.participants ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    }
    setLoading(false);
  }

  useEffect(() => {
    if (tournamentId) load();
  }, [tournamentId]);

  async function createInviteLink() {
    setCreatingInvite(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const { data, error: insErr } = await supabase
        .from("tournament_invites")
        .insert({ tournament_id: tournamentId, created_by: session.user.id })
        .select("id")
        .single();

      if (insErr) return;
      const url = `${window.location.origin}/tournaments/invite/${data.id}`;
      setInviteUrl(url);
    } catch {}
    setCreatingInvite(false);
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function startTournament() {
    setStartingTournament(true);
    setStartError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "start", tournament_id: tournamentId }),
      });

      const json = await res.json();
      if (!res.ok) { setStartError(json.error ?? "Failed to start"); setStartingTournament(false); return; }

      // Reload to reflect new status
      load();
    } catch (e: any) {
      setStartError(e?.message ?? "Something went wrong");
    }
    setStartingTournament(false);
  }

  const unit = tournament?.period_type === "weekly" ? "Week" : "Month";

  const trends = useMemo(
    () => computeTrends(standings, currentPeriod),
    [standings, currentPeriod]
  );

  // Find in-progress round for current user
  const myInProgressRound = useMemo(() => {
    if (!meId) return null;
    return rounds.find((r: any) => r.user_id === meId && r.completed === false) ?? null;
  }, [rounds, meId]);

  // Build a map of round_id by (user_id, period_number) for linking
  const roundIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of rounds as any[]) {
      map[`${r.user_id}_${r.period_number}`] = r.id;
    }
    return map;
  }, [rounds]);

  // How many periods have any scores at all (for the breakdown columns)
  const activePeriods = useMemo(() => {
    const set = new Set<number>();
    for (const s of standings) {
      for (const p of Object.keys(s.period_scores)) set.add(Number(p));
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [standings]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-2xl bg-black/[0.03]" />
        <div className="h-10 animate-pulse rounded-xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
        <div className="h-48 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "150ms" }} />
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm font-medium text-[var(--ink)]">{error ?? "Tournament not found"}</div>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button" onClick={load} className="rounded-xl bg-[var(--pine)] px-4 py-2 text-sm font-semibold text-white">
            Try again
          </button>
          <Link href="/tournaments" className="text-sm text-[var(--pine)] underline">Back</Link>
        </div>
      </div>
    );
  }

  const periodEntries = viewPeriod === "overall" ? null : (periodLeaderboards[viewPeriod] ?? []);

  // Leader highlight for overall view
  const leader = standings.length > 0 && standings[0].avg_differential != null ? standings[0] : null;
  const leaderProfile = leader ? profiles[leader.user_id] : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link href="/tournaments" className="text-sm text-[var(--pine)] font-medium">&larr; Tournaments</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{tournament.name}</h1>
        {tournament.description && (
          <p className="mt-1 text-sm text-[var(--muted)]">{tournament.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span>
            {new Date(tournament.start_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date(tournament.end_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <span className="text-[var(--border)]">&middot;</span>
          <span>{tournament.period_count} {unit.toLowerCase()}{tournament.period_count !== 1 ? "s" : ""}</span>
          <span className="text-[var(--border)]">&middot;</span>
          <span>{standings.length} player{standings.length !== 1 ? "s" : ""}</span>
          {tournament.status === "active" && (
            <>
              <span className="text-[var(--border)]">&middot;</span>
              <span className="font-medium text-[var(--pine)]">Currently {unit} {currentPeriod}</span>
            </>
          )}
          {tournament.status === "draft" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200/60">Setting up</span>
          )}
          {tournament.status === "completed" && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200/60">Completed</span>
          )}
        </div>
      </div>

      {/* Draft setup section */}
      {tournament.status === "draft" && (
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-dashed border-amber-300/60 bg-amber-50/30 p-5">
            <h2 className="text-sm font-semibold text-amber-800">Add players, then start the tournament</h2>
            <p className="mt-1 text-xs text-amber-700/80">
              Share the invite link to add everyone. Scoring opens once you start the tournament.
            </p>

            {/* Participant list */}
            <div className="mt-4 space-y-2">
              {participants.filter((p: any) => p.status === "accepted").map((p: any) => {
                const prof = profiles[p.user_id];
                const name = prof?.display_name || "Unknown";
                return (
                  <div key={p.user_id} className="flex items-center gap-2.5">
                    <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white">
                      {prof?.avatar_url ? (
                        <img src={prof.avatar_url} alt={name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[9px] font-semibold">{initials(name)}</div>
                      )}
                    </div>
                    <span className="text-sm font-medium text-[var(--ink)]">{name}</span>
                    {p.user_id === tournament.creator_id && (
                      <span className="text-[10px] text-[var(--muted)]">(organizer)</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Invite button */}
            <div className="mt-4 flex gap-2">
              {!inviteUrl ? (
                <button
                  type="button"
                  onClick={createInviteLink}
                  disabled={creatingInvite}
                  className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:shadow-sm disabled:opacity-60"
                >
                  {creatingInvite ? "Creating..." : "Invite friends"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={copyInvite}
                  className="rounded-xl border border-[var(--pine)]/30 bg-[var(--pine)]/5 px-4 py-2.5 text-sm font-semibold text-[var(--pine)] transition hover:shadow-sm"
                >
                  {copied ? "Copied!" : "Copy invite link"}
                </button>
              )}
            </div>

            {/* Start tournament button — creator only */}
            {isCreator && (
              <div className="mt-5 border-t border-amber-200/40 pt-4">
                {startError && (
                  <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{startError}</div>
                )}
                <button
                  type="button"
                  onClick={startTournament}
                  disabled={startingTournament}
                  className="rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
                >
                  {startingTournament ? "Starting..." : "Start tournament"}
                </button>
                <p className="mt-2 text-[11px] text-amber-700/70">
                  Needs at least 2 players. Once started, scoring opens and no more players can be added.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* In-progress round banner */}
      {tournament.status === "active" && myInProgressRound && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-amber-800">
              You have a round in progress at <span className="font-semibold">{(myInProgressRound as any).course_name || "the course"}</span>.
            </div>
            <Link
              href={`/tournaments/${tournamentId}/score/${myInProgressRound.id}`}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Continue scoring
            </Link>
          </div>
        </div>
      )}

      {/* Actions — only when active */}
      {tournament.status !== "draft" && (
        <div className="flex gap-2">
          {tournament.status === "active" && (
            <Link
              href={`/tournaments/${tournamentId}/submit`}
              className="rounded-xl bg-[var(--pine)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
            >
              Start a round
            </Link>
          )}
          {!inviteUrl ? (
            <button
              type="button"
              onClick={createInviteLink}
              disabled={creatingInvite}
              className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:shadow-sm disabled:opacity-60"
            >
              {creatingInvite ? "Creating..." : "Invite friends"}
            </button>
          ) : (
            <button
              type="button"
              onClick={copyInvite}
              className="rounded-xl border border-[var(--pine)]/30 bg-[var(--pine)]/5 px-4 py-2.5 text-sm font-semibold text-[var(--pine)] transition hover:shadow-sm"
            >
              {copied ? "Copied!" : "Copy invite link"}
            </button>
          )}
        </div>
      )}

      {/* Everything below only shows once tournament is active or completed */}
      {tournament.status !== "draft" && (<>

      {/* Leader card — only in overall view when there's a leader */}
      {viewPeriod === "overall" && leader && leaderProfile && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--pine)] to-[var(--pine)]/80 px-4 py-4 text-white shadow-sm sm:px-5">
          <div className="absolute top-2 right-3 text-3xl opacity-20">🏆</div>
          <div className="flex items-center gap-3">
            <div className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-full bg-white/20 ring-2 ring-white/30">
              {leaderProfile.avatar_url ? (
                <img src={leaderProfile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center text-sm font-semibold">
                  {initials(leaderProfile.display_name || "?")}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-70">Tournament Leader</div>
              <div className="truncate text-base font-semibold">
                {leaderProfile.display_name || "Unknown"}
                {leader.user_id === meId && <span className="ml-1.5 text-xs opacity-70">(You!)</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold tabular-nums">{leader.avg_differential!.toFixed(1)}</div>
              <div className="text-[11px] opacity-70">avg differential</div>
            </div>
          </div>
        </div>
      )}

      {/* Period selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          type="button"
          onClick={() => setViewPeriod("overall")}
          className={cx(
            "flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition",
            viewPeriod === "overall"
              ? "bg-[var(--pine)] text-white"
              : "bg-black/[0.04] text-[var(--muted)] hover:bg-black/[0.07]"
          )}
        >
          Overall
        </button>
        {Array.from({ length: tournament.period_count }, (_, i) => i + 1).map((p) => {
          const isFuture = p > currentPeriod && tournament.status === "active";
          return (
            <button
              key={p}
              type="button"
              onClick={() => setViewPeriod(p)}
              disabled={isFuture}
              className={cx(
                "flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition",
                viewPeriod === p
                  ? "bg-[var(--pine)] text-white"
                  : isFuture
                  ? "bg-black/[0.02] text-[var(--muted)]/50 cursor-not-allowed"
                  : p === currentPeriod && tournament.status === "active"
                  ? "bg-[var(--pine)]/10 text-[var(--pine)] hover:bg-[var(--pine)]/15"
                  : "bg-black/[0.04] text-[var(--muted)] hover:bg-black/[0.07]"
              )}
            >
              {unit[0]}{p}
              {p === currentPeriod && tournament.status === "active" && viewPeriod !== p && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--pine)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Leaderboard */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            {viewPeriod === "overall" ? "Overall Standings" : `${unit} ${viewPeriod} Leaderboard`}
          </h2>
          {viewPeriod === "overall" && (
            <p className="text-xs text-[var(--muted)] mt-0.5">Ranked by average best differential per period</p>
          )}
        </div>

        {viewPeriod === "overall" ? (
          /* Overall standings with period breakdown */
          <div>
            {/* Period column headers — scrollable on mobile */}
            {standings.length > 0 && activePeriods.length > 0 && (
              <div className="overflow-x-auto border-b border-[var(--border)]/50">
                <div className="flex items-center gap-0 px-3 py-2 sm:px-5" style={{ minWidth: activePeriods.length > 4 ? `${320 + activePeriods.length * 52}px` : undefined }}>
                  {/* Spacer for rank + avatar + name */}
                  <div className="flex-1 min-w-[160px]" />
                  {/* Period columns */}
                  {activePeriods.map((p) => (
                    <div key={p} className="w-[48px] flex-shrink-0 text-center">
                      <button
                        type="button"
                        onClick={() => setViewPeriod(p)}
                        className="text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--pine)] transition"
                      >
                        {unit[0]}{p}
                      </button>
                    </div>
                  ))}
                  {/* Avg column */}
                  <div className="w-[56px] flex-shrink-0 text-center">
                    <span className="text-[10px] font-semibold text-[var(--muted)]">Avg</span>
                  </div>
                  {/* Trend column */}
                  <div className="w-[32px] flex-shrink-0" />
                </div>
              </div>
            )}

            <div className="divide-y divide-[var(--border)]/50">
              {standings.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">No players yet</div>
              ) : (
                standings.map((s, i) => {
                  const prof = profiles[s.user_id];
                  const name = prof?.display_name || "Unknown";
                  const isMe = s.user_id === meId;
                  const position = i + 1;
                  const trend = trends[s.user_id];

                  return (
                    <div
                      key={s.user_id}
                      className={cx(
                        "overflow-x-auto",
                        isMe && "bg-[var(--pine)]/[0.04]"
                      )}
                    >
                      <div
                        className="flex items-center gap-0 px-3 py-3 sm:px-5"
                        style={{ minWidth: activePeriods.length > 4 ? `${320 + activePeriods.length * 52}px` : undefined }}
                      >
                        {/* Rank + Avatar + Name */}
                        <div className="flex items-center gap-2.5 flex-1 min-w-[160px] sm:gap-3">
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center text-sm font-semibold text-[var(--muted)]">
                            {position <= 3 ? (
                              <span className="text-base">{position === 1 ? "🥇" : position === 2 ? "🥈" : "🥉"}</span>
                            ) : (
                              position
                            )}
                          </div>
                          <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white sm:h-9 sm:w-9">
                            {prof?.avatar_url ? (
                              <img src={prof.avatar_url} alt={name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="grid h-full w-full place-items-center text-[10px] font-semibold sm:text-xs">{initials(name)}</div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-[var(--ink)]">{name}</span>
                              {isMe && (
                                <span className="rounded-full bg-[var(--pine)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--pine)]">You</span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--muted)] sm:text-xs">
                              {s.periods_played}/{tournament.period_count} {unit.toLowerCase()}s
                            </div>
                          </div>
                        </div>

                        {/* Period-by-period scores */}
                        {activePeriods.map((p) => {
                          const score = s.period_scores[p];
                          const rid = score?.round_id;
                          return (
                            <div key={p} className="w-[48px] flex-shrink-0 text-center">
                              {score ? (
                                rid ? (
                                  <Link
                                    href={`/tournaments/${tournamentId}/round/${rid}`}
                                    className="text-xs font-medium tabular-nums text-[var(--pine)] underline decoration-[var(--pine)]/30 hover:decoration-[var(--pine)]"
                                  >
                                    {score.differential.toFixed(1)}
                                  </Link>
                                ) : (
                                  <span className="text-xs font-medium tabular-nums text-[var(--ink)]">
                                    {score.differential.toFixed(1)}
                                  </span>
                                )
                              ) : (
                                <span className="text-[11px] text-[var(--muted)]/50">—</span>
                              )}
                            </div>
                          );
                        })}

                        {/* Avg differential */}
                        <div className="w-[56px] flex-shrink-0 text-center">
                          {s.avg_differential != null ? (
                            <span className="text-sm font-bold tabular-nums text-[var(--ink)]">
                              {s.avg_differential.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">—</span>
                          )}
                        </div>

                        {/* Trend arrow */}
                        <div className="w-[32px] flex-shrink-0 text-center">
                          <TrendArrow change={trend} />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* Period leaderboard */
          <div className="divide-y divide-[var(--border)]/50">
            {!periodEntries || periodEntries.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
                No rounds submitted for {unit} {viewPeriod}
              </div>
            ) : (
              periodEntries.map((entry, i) => {
                const prof = profiles[entry.user_id];
                const name = prof?.display_name || "Unknown";
                const isMe = entry.user_id === meId;
                const position = i + 1;
                const hasRoundLink = !!entry.round_id;

                const content = (
                  <>
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center text-sm font-semibold text-[var(--muted)]">
                      {position <= 3 ? (
                        <span className="text-base">{position === 1 ? "🥇" : position === 2 ? "🥈" : "🥉"}</span>
                      ) : (
                        position
                      )}
                    </div>
                    <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white sm:h-9 sm:w-9">
                      {prof?.avatar_url ? (
                        <img src={prof.avatar_url} alt={name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[10px] font-semibold sm:text-xs">{initials(name)}</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-[var(--ink)]">{name}</span>
                        {isMe && (
                          <span className="rounded-full bg-[var(--pine)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--pine)]">You</span>
                        )}
                        {position === 1 && (
                          <span className="rounded-full bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Winner</span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-[var(--muted)] sm:text-xs">
                        {entry.course_name} &middot; {entry.gross_score} gross
                        {hasRoundLink && <span className="ml-1 text-[var(--pine)]">View scorecard &rarr;</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold tabular-nums text-[var(--ink)]">
                        {entry.differential.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">diff</div>
                    </div>
                  </>
                );

                return hasRoundLink ? (
                  <Link
                    key={entry.user_id}
                    href={`/tournaments/${tournamentId}/round/${entry.round_id}`}
                    className={cx(
                      "flex items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-5 transition hover:bg-black/[0.02]",
                      isMe && "bg-[var(--pine)]/[0.04]"
                    )}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={entry.user_id}
                    className={cx(
                      "flex items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-5",
                      isMe && "bg-[var(--pine)]/[0.04]"
                    )}
                  >
                    {content}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Scoring explainer */}
      <div className="rounded-xl border border-[var(--border)] bg-white/40 px-4 py-3">
        <div className="text-xs text-[var(--muted)]">
          <span className="font-medium">Differential</span> = (113 &divide; Slope) &times; (Score &minus; Course Rating).
          Lower is better. This normalizes scores across different courses so everyone competes fairly.
        </div>
      </div>

      </>)}
    </div>
  );
}
