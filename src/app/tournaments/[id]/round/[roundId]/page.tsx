"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type RoundData = {
  id: string;
  tournament_id: string;
  user_id: string;
  period_number: number;
  course_name: string;
  tee_name: string | null;
  gross_score: number | null;
  course_rating: number;
  slope_rating: number;
  par: number | null;
  differential: number | null;
  completed: boolean;
  played_at: string;
};

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

type TeeData = {
  par?: number;
  holes?: Array<{ number?: number; hole?: number; par?: number; yardage?: number; yards?: number }>;
};

function getHolePar(tee: TeeData | null, holeNo: number): number | null {
  if (!tee?.holes) return null;
  const h = tee.holes.find(h => (h.number ?? h.hole) === holeNo);
  return h?.par ?? null;
}

export default function ViewRoundPage() {
  const params = useParams();
  const tournamentId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const roundId = typeof params?.roundId === "string" ? params.roundId : Array.isArray(params?.roundId) ? params.roundId[0] : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scores, setScores] = useState<Map<number, number>>(new Map());
  const [tournamentName, setTournamentName] = useState("");
  const [teeData, setTeeData] = useState<TeeData | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) { setError("Not signed in"); setLoading(false); return; }

        const res = await fetch(`/api/tournaments/${tournamentId}/rounds/${roundId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? "Round not found");
          setLoading(false);
          return;
        }

        const json = await res.json();
        setRound(json.round);
        setProfile(json.profile ?? null);

        const scoreMap = new Map<number, number>();
        for (const h of (json.holes ?? []) as { hole_no: number; strokes: number }[]) {
          if (typeof h.strokes === "number") scoreMap.set(h.hole_no, h.strokes);
        }
        setScores(scoreMap);

        // Tournament name
        const tRes = await fetch(`/api/tournaments/${tournamentId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (tRes.ok) {
          const tJson = await tRes.json();
          setTournamentName(tJson.tournament?.name ?? "");
        }

        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
        setLoading(false);
      }
    }
    if (tournamentId && roundId) load();
  }, [tournamentId, roundId]);

  const frontNine = useMemo(() => {
    let total = 0;
    for (let h = 1; h <= 9; h++) total += scores.get(h) ?? 0;
    return total;
  }, [scores]);

  const backNine = useMemo(() => {
    let total = 0;
    for (let h = 10; h <= 18; h++) total += scores.get(h) ?? 0;
    return total;
  }, [scores]);

  const grossTotal = frontNine + backNine;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-black/[0.03]" />
        <div className="h-48 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
      </div>
    );
  }

  if (error || !round) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm font-medium text-[var(--ink)]">{error ?? "Round not found"}</div>
        <Link href={`/tournaments/${tournamentId}`} className="mt-3 inline-block text-sm text-[var(--pine)] underline">
          Back to tournament
        </Link>
      </div>
    );
  }

  const playerName = profile?.display_name || "Unknown";
  const isInProgress = !round.completed;

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/tournaments/${tournamentId}`} className="text-sm text-[var(--pine)] font-medium">
          &larr; {tournamentName || "Tournament"}
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {playerName}&apos;s Round
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span>{round.course_name}</span>
          {round.tee_name && (
            <>
              <span className="text-[var(--border)]">&middot;</span>
              <span>{round.tee_name} tees</span>
            </>
          )}
          <span className="text-[var(--border)]">&middot;</span>
          <span>{new Date(round.played_at + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
          {isInProgress && (
            <>
              <span className="text-[var(--border)]">&middot;</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">In Progress</span>
            </>
          )}
        </div>
      </div>

      {/* Player card */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/60 px-4 py-4">
        <div className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)]">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt={playerName} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-sm font-semibold">{initials(playerName)}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--ink)]">{playerName}</div>
          {profile?.handicap_index != null && (
            <div className="text-xs text-[var(--muted)]">HCP {profile.handicap_index}</div>
          )}
        </div>
        <div className="text-right">
          {round.completed ? (
            <>
              <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">{round.gross_score}</div>
              <div className="text-xs text-[var(--muted)]">
                {round.differential != null ? `${round.differential.toFixed(1)} diff` : ""}
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">{grossTotal}</div>
              <div className="text-xs text-[var(--muted)]">{scores.size}/18 holes</div>
            </>
          )}
        </div>
      </div>

      {/* Scorecard */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Scorecard</h2>
        </div>

        {/* Front 9 */}
        <div className="border-b border-[var(--border)]/50 px-2 py-2">
          <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wide px-2 mb-1">Front 9</div>
          <div className="grid grid-cols-10 text-center text-xs">
            {/* Hole numbers */}
            {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => (
              <div key={h} className="py-1 text-[var(--muted)] font-medium">{h}</div>
            ))}
            <div className="py-1 text-[var(--muted)] font-bold">Out</div>
            {/* Par row */}
            {teeData?.holes && (
              <>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => {
                  const p = getHolePar(teeData, h);
                  return <div key={h} className="py-1 text-[var(--muted)]">{p ?? ""}</div>;
                })}
                <div className="py-1 text-[var(--muted)] font-medium">
                  {Array.from({ length: 9 }, (_, i) => getHolePar(teeData, i + 1) ?? 0).reduce((a, b) => a + b, 0) || ""}
                </div>
              </>
            )}
            {/* Score row */}
            {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => {
              const s = scores.get(h);
              const p = getHolePar(teeData, h);
              const color = s != null && p != null
                ? (s < p ? "text-red-600 font-bold" : s > p ? "text-blue-600" : "text-[var(--ink)]")
                : "text-[var(--ink)]";
              return (
                <div key={h} className={cx("py-1 font-semibold tabular-nums", color)}>
                  {s ?? "—"}
                </div>
              );
            })}
            <div className="py-1 font-bold tabular-nums text-[var(--ink)]">{frontNine || "—"}</div>
          </div>
        </div>

        {/* Back 9 */}
        <div className="px-2 py-2">
          <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wide px-2 mb-1">Back 9</div>
          <div className="grid grid-cols-10 text-center text-xs">
            {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => (
              <div key={h} className="py-1 text-[var(--muted)] font-medium">{h}</div>
            ))}
            <div className="py-1 text-[var(--muted)] font-bold">In</div>
            {teeData?.holes && (
              <>
                {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => {
                  const p = getHolePar(teeData, h);
                  return <div key={h} className="py-1 text-[var(--muted)]">{p ?? ""}</div>;
                })}
                <div className="py-1 text-[var(--muted)] font-medium">
                  {Array.from({ length: 9 }, (_, i) => getHolePar(teeData, i + 10) ?? 0).reduce((a, b) => a + b, 0) || ""}
                </div>
              </>
            )}
            {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => {
              const s = scores.get(h);
              const p = getHolePar(teeData, h);
              const color = s != null && p != null
                ? (s < p ? "text-red-600 font-bold" : s > p ? "text-blue-600" : "text-[var(--ink)]")
                : "text-[var(--ink)]";
              return (
                <div key={h} className={cx("py-1 font-semibold tabular-nums", color)}>
                  {s ?? "—"}
                </div>
              );
            })}
            <div className="py-1 font-bold tabular-nums text-[var(--ink)]">{backNine || "—"}</div>
          </div>
        </div>

        {/* Total row */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--ink)]">Total</span>
          <div className="flex items-center gap-4">
            <span className="text-lg font-bold tabular-nums text-[var(--ink)]">{grossTotal || "—"}</span>
            {round.par && grossTotal > 0 && (
              <span className="text-sm font-medium tabular-nums text-[var(--muted)]">
                {grossTotal - round.par === 0 ? "E" : grossTotal - round.par > 0 ? `+${grossTotal - round.par}` : grossTotal - round.par}
              </span>
            )}
            {round.differential != null && (
              <span className="rounded-full bg-[var(--pine)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--pine)]">
                {round.differential.toFixed(1)} diff
              </span>
            )}
          </div>
        </div>
      </div>

      <Link
        href={`/tournaments/${tournamentId}`}
        className="inline-block rounded-xl border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:shadow-sm"
      >
        &larr; Back to standings
      </Link>
    </div>
  );
}
