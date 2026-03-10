"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  period_bests: Record<number, { differential: number; gross_score: number; course_name: string }>;
};

type PeriodEntry = {
  user_id: string;
  differential: number;
  gross_score: number;
  course_name: string;
};

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

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

  const [viewPeriod, setViewPeriod] = useState<"overall" | number>("overall");

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

      // Create invite token via direct Supabase insert
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

  const unit = tournament?.period_type === "weekly" ? "Week" : "Month";

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
          {tournament.status === "completed" && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200/60">Completed</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {tournament.status === "active" && (
          <Link
            href={`/tournaments/${tournamentId}/submit`}
            className="rounded-xl bg-[var(--pine)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
          >
            Submit a round
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
          /* Overall standings */
          <div className="divide-y divide-[var(--border)]/50">
            {standings.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">No players yet</div>
            ) : (
              standings.map((s, i) => {
                const prof = profiles[s.user_id];
                const name = prof?.display_name || "Unknown";
                const isMe = s.user_id === meId;
                const position = i + 1;

                return (
                  <div
                    key={s.user_id}
                    className={cx(
                      "flex items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-5",
                      isMe && "bg-[var(--pine)]/[0.04]"
                    )}
                  >
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center text-sm font-semibold text-[var(--muted)]">
                      {position <= 3 ? (
                        <span className="text-base">{position === 1 ? "\uD83E\uDD47" : position === 2 ? "\uD83E\uDD48" : "\uD83E\uDD49"}</span>
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
                      </div>
                      <div className="text-[11px] text-[var(--muted)] sm:text-xs">
                        {s.rounds_played} round{s.rounds_played !== 1 ? "s" : ""} &middot;{" "}
                        {s.periods_played}/{tournament.period_count} {unit.toLowerCase()}s
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {s.avg_differential != null ? (
                        <>
                          <div className="text-sm font-semibold tabular-nums text-[var(--ink)]">
                            {s.avg_differential.toFixed(1)}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]">avg diff</div>
                        </>
                      ) : (
                        <div className="text-xs text-[var(--muted)]">No rounds</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
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

                return (
                  <div
                    key={entry.user_id}
                    className={cx(
                      "flex items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-5",
                      isMe && "bg-[var(--pine)]/[0.04]"
                    )}
                  >
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center text-sm font-semibold text-[var(--muted)]">
                      {position <= 3 ? (
                        <span className="text-base">{position === 1 ? "\uD83E\uDD47" : position === 2 ? "\uD83E\uDD48" : "\uD83E\uDD49"}</span>
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
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold tabular-nums text-[var(--ink)]">
                        {entry.differential.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">diff</div>
                    </div>
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
    </div>
  );
}
