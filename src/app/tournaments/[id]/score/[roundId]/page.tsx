"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx } from "@/lib/utils";

const TOTAL_HOLES = 18;

type RoundData = {
  id: string;
  tournament_id: string;
  user_id: string;
  period_number: number;
  course_name: string;
  tee_name: string | null;
  course_rating: number;
  slope_rating: number;
  par: number | null;
  gross_score: number | null;
  differential: number | null;
  completed: boolean;
};

type TeeData = {
  par?: number;
  holes?: Array<{
    number?: number;
    hole?: number;
    par?: number;
    yardage?: number;
    yards?: number;
  }>;
};

function getHolePar(tee: TeeData | null, holeNo: number): number | null {
  if (!tee?.holes) return null;
  const h = tee.holes.find(h => (h.number ?? h.hole) === holeNo);
  return h?.par ?? null;
}

function getHoleYards(tee: TeeData | null, holeNo: number): number | null {
  if (!tee?.holes) return null;
  const h = tee.holes.find(h => (h.number ?? h.hole) === holeNo);
  return h?.yardage ?? h?.yards ?? null;
}

export default function TournamentScoringPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const roundId = typeof params?.roundId === "string" ? params.roundId : Array.isArray(params?.roundId) ? params.roundId[0] : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [tournamentName, setTournamentName] = useState("");
  const [scores, setScores] = useState<Map<number, number>>(new Map());

  const [holeNo, setHoleNo] = useState(1);
  const [strokesInput, setStrokesInput] = useState("");
  const [completed, setCompleted] = useState(false);
  const [grossScore, setGrossScore] = useState<number | null>(null);
  const [differential, setDifferential] = useState<number | null>(null);

  const [teeData, setTeeData] = useState<TeeData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
          setError(json.error ?? "Failed to load round");
          setLoading(false);
          return;
        }

        const json = await res.json();
        const r = json.round as RoundData;
        setRound(r);
        setCompleted(r.completed);

        if (r.completed) {
          setGrossScore(r.gross_score);
          setDifferential(r.differential);
        }

        // Load hole scores
        const scoreMap = new Map<number, number>();
        for (const h of (json.holes ?? []) as { hole_no: number; strokes: number }[]) {
          if (typeof h.strokes === "number") scoreMap.set(h.hole_no, h.strokes);
        }
        setScores(scoreMap);

        // Set to first unscored hole
        if (!r.completed) {
          for (let h = 1; h <= TOTAL_HOLES; h++) {
            if (!scoreMap.has(h)) { setHoleNo(h); break; }
          }
        }

        // Load tournament name
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

  const runningTotal = useMemo(() => {
    let total = 0;
    for (const [, s] of scores) total += s;
    return total;
  }, [scores]);

  const parTotal = useMemo(() => {
    if (!teeData?.holes) return round?.par ?? null;
    let total = 0;
    for (let h = 1; h <= TOTAL_HOLES; h++) {
      const p = getHolePar(teeData, h);
      if (p) total += p;
    }
    return total || round?.par || null;
  }, [teeData, round]);

  const navigateToHole = useCallback((h: number) => {
    if (h < 1 || h > TOTAL_HOLES) return;
    setHoleNo(h);
    const existing = scores.get(h);
    setStrokesInput(existing != null ? String(existing) : "");
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [scores]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target === inputRef.current;
      const isOther = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (isOther && !isInput) return;

      if (e.key === "ArrowLeft") { e.preventDefault(); navigateToHole(holeNo - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); navigateToHole(holeNo + 1); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [holeNo, navigateToHole]);

  async function saveHole() {
    if (!round || completed) return;
    const strokes = Number(strokesInput);
    if (!strokes || strokes < 1 || strokes > 20) {
      setError("Enter strokes (1-20)");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError("Not signed in"); setSaving(false); return; }

      const res = await fetch(`/api/tournaments/${tournamentId}/rounds/${roundId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ hole_no: holeNo, strokes }),
      });

      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to save"); setSaving(false); return; }

      // Update local scores
      setScores((prev) => {
        const next = new Map(prev);
        next.set(holeNo, strokes);
        return next;
      });

      if (json.completed) {
        setCompleted(true);
        setGrossScore(json.gross_score);
        setDifferential(json.differential);
      } else {
        // Auto-advance to next unscored hole
        for (let h = holeNo + 1; h <= TOTAL_HOLES; h++) {
          if (!scores.has(h) && h !== holeNo) {
            navigateToHole(h);
            break;
          }
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    }
    setSaving(false);
  }

  async function deleteHole() {
    if (!round || completed) return;
    if (!scores.has(holeNo)) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`/api/tournaments/${tournamentId}/rounds/${roundId}?hole_no=${holeNo}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        setScores((prev) => {
          const next = new Map(prev);
          next.delete(holeNo);
          return next;
        });
        setStrokesInput("");
      }
    } catch {}
  }

  const holePar = getHolePar(teeData, holeNo);
  const holeYards = getHoleYards(teeData, holeNo);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-black/[0.03]" />
        <div className="h-48 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
        <div className="h-32 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "150ms" }} />
      </div>
    );
  }

  if (error && !round) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm font-medium text-[var(--ink)]">{error}</div>
        <Link href={`/tournaments/${tournamentId}`} className="mt-3 inline-block text-sm text-[var(--pine)] underline">
          Back to tournament
        </Link>
      </div>
    );
  }

  if (!round) return null;

  // Completed state
  if (completed) {
    return (
      <div className="space-y-5">
        <div>
          <Link href={`/tournaments/${tournamentId}`} className="text-sm text-[var(--pine)] font-medium">
            &larr; {tournamentName || "Tournament"}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Round Complete!</h1>
        </div>

        <div className="rounded-2xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 p-6 text-center">
          <div className="text-sm font-medium text-[var(--pine)] uppercase tracking-wide">Your Score</div>
          <div className="mt-2 text-4xl font-bold tabular-nums text-[var(--ink)]">{grossScore}</div>
          {parTotal && grossScore && (
            <div className="mt-1 text-sm text-[var(--muted)]">
              {grossScore - parTotal === 0 ? "Even" : grossScore - parTotal > 0 ? `+${grossScore - parTotal}` : grossScore - parTotal}
            </div>
          )}
          <div className="mt-3 text-xs text-[var(--muted)]">Differential</div>
          <div className="text-2xl font-bold tabular-nums text-[var(--pine)]">{differential?.toFixed(1)}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{round.course_name}</div>
        </div>

        {/* Scorecard grid */}
        <div className="rounded-2xl border border-[var(--border)] bg-white/60 overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Scorecard</h2>
          </div>
          <div className="grid grid-cols-9 text-center text-xs">
            {/* Front 9 header */}
            {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => (
              <div key={h} className="border-b border-r border-[var(--border)]/50 py-1.5 text-[var(--muted)] font-medium">{h}</div>
            ))}
            {/* Front 9 scores */}
            {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => {
              const s = scores.get(h);
              const p = getHolePar(teeData, h);
              const scoreClass = s && p ? (s < p ? "text-red-600 font-bold" : s > p ? "text-blue-600" : "text-[var(--ink)]") : "text-[var(--ink)]";
              return (
                <div key={h} className={cx("border-b border-r border-[var(--border)]/50 py-1.5 font-semibold tabular-nums", scoreClass)}>
                  {s ?? "—"}
                </div>
              );
            })}
            {/* Back 9 header */}
            {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => (
              <div key={h} className="border-b border-r border-[var(--border)]/50 py-1.5 text-[var(--muted)] font-medium">{h}</div>
            ))}
            {/* Back 9 scores */}
            {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => {
              const s = scores.get(h);
              const p = getHolePar(teeData, h);
              const scoreClass = s && p ? (s < p ? "text-red-600 font-bold" : s > p ? "text-blue-600" : "text-[var(--ink)]") : "text-[var(--ink)]";
              return (
                <div key={h} className={cx("border-b border-r border-[var(--border)]/50 py-1.5 font-semibold tabular-nums", scoreClass)}>
                  {s ?? "—"}
                </div>
              );
            })}
          </div>
        </div>

        <Link
          href={`/tournaments/${tournamentId}`}
          className="inline-block rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
        >
          Back to tournament
        </Link>
      </div>
    );
  }

  // Active scoring state
  return (
    <div className="space-y-5">
      <div>
        <Link href={`/tournaments/${tournamentId}`} className="text-sm text-[var(--pine)] font-medium">
          &larr; {tournamentName || "Tournament"}
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">{round.course_name}</h1>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-[var(--ink)]">{runningTotal}</div>
            <div className="text-[10px] text-[var(--muted)]">{scores.size}/{TOTAL_HOLES} holes</div>
          </div>
        </div>
        {round.tee_name && (
          <div className="text-xs text-[var(--muted)]">{round.tee_name} tees</div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      {/* Current hole scoring */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5">
        <div className="text-center">
          <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Hole</div>
          <div className="text-4xl font-bold text-[var(--ink)]">{holeNo}</div>
          {(holePar || holeYards) && (
            <div className="mt-1 flex items-center justify-center gap-3 text-xs text-[var(--muted)]">
              {holePar && <span>Par {holePar}</span>}
              {holeYards && <span>{holeYards} yds</span>}
            </div>
          )}
        </div>

        <div className="mt-5">
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-4 text-center text-2xl font-bold outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm tabular-nums"
            value={strokesInput}
            onChange={(e) => setStrokesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); saveHole(); }
            }}
            placeholder="—"
            min={1}
            max={20}
            autoFocus
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={saveHole}
            disabled={saving || !strokesInput}
            className="flex-1 rounded-xl bg-[var(--pine)] py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {scores.has(holeNo) && (
            <button
              type="button"
              onClick={deleteHole}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100"
            >
              Undo
            </button>
          )}
        </div>

        {/* Hole navigation */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigateToHole(holeNo - 1)}
            disabled={holeNo <= 1}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--pine)] disabled:opacity-30"
          >
            &larr; Prev
          </button>
          <span className="text-xs text-[var(--muted)]">Hole {holeNo} of {TOTAL_HOLES}</span>
          <button
            type="button"
            onClick={() => navigateToHole(holeNo + 1)}
            disabled={holeNo >= TOTAL_HOLES}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--pine)] disabled:opacity-30"
          >
            Next &rarr;
          </button>
        </div>
      </div>

      {/* Hole grid */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Scorecard</h2>
        </div>
        <div className="grid grid-cols-9 text-center text-xs">
          {/* Front 9 */}
          {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => (
            <button
              key={`label-${h}`}
              type="button"
              onClick={() => navigateToHole(h)}
              className={cx(
                "border-b border-r border-[var(--border)]/50 py-1.5 font-medium transition",
                h === holeNo ? "bg-[var(--pine)]/10 text-[var(--pine)]" : "text-[var(--muted)] hover:bg-black/[0.02]"
              )}
            >
              {h}
            </button>
          ))}
          {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => {
            const s = scores.get(h);
            const p = getHolePar(teeData, h);
            const color = s != null && p != null ? (s < p ? "text-red-600 font-bold" : s > p ? "text-blue-600" : "") : "";
            return (
              <button
                key={`score-${h}`}
                type="button"
                onClick={() => navigateToHole(h)}
                className={cx(
                  "border-b border-r border-[var(--border)]/50 py-1.5 font-semibold tabular-nums transition",
                  h === holeNo ? "bg-[var(--pine)]/10" : "hover:bg-black/[0.02]",
                  color || "text-[var(--ink)]"
                )}
              >
                {s ?? "—"}
              </button>
            );
          })}
          {/* Back 9 */}
          {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => (
            <button
              key={`label-${h}`}
              type="button"
              onClick={() => navigateToHole(h)}
              className={cx(
                "border-b border-r border-[var(--border)]/50 py-1.5 font-medium transition",
                h === holeNo ? "bg-[var(--pine)]/10 text-[var(--pine)]" : "text-[var(--muted)] hover:bg-black/[0.02]"
              )}
            >
              {h}
            </button>
          ))}
          {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => {
            const s = scores.get(h);
            const p = getHolePar(teeData, h);
            const color = s != null && p != null ? (s < p ? "text-red-600 font-bold" : s > p ? "text-blue-600" : "") : "";
            return (
              <button
                key={`score-${h}`}
                type="button"
                onClick={() => navigateToHole(h)}
                className={cx(
                  "border-b border-r border-[var(--border)]/50 py-1.5 font-semibold tabular-nums transition",
                  h === holeNo ? "bg-[var(--pine)]/10" : "hover:bg-black/[0.02]",
                  color || "text-[var(--ink)]"
                )}
              >
                {s ?? "—"}
              </button>
            );
          })}
        </div>
        {/* Running total */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
          <span className="text-xs font-medium text-[var(--muted)]">Total</span>
          <span className="text-sm font-bold tabular-nums text-[var(--ink)]">
            {runningTotal}
            {parTotal ? (
              <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                ({runningTotal - parTotal === 0 ? "E" : runningTotal - parTotal > 0 ? `+${runningTotal - parTotal}` : runningTotal - parTotal})
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
