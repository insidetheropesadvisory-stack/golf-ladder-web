"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";

type MatchRow = {
  id: string;
  creator_id: string;
  creator_email?: string;
  opponent_id: string | null;
  opponent_email: string;
  course_name: string;
  status: string;
  completed: boolean;
  terms_status: string | null;
  format: "stroke_play" | "match_play";
  use_handicap: boolean;
  round_time: string | null;
};

type HoleRow = {
  match_id: string;
  hole_no: number;
  player_id: string;
  strokes: number | null;
  locked: boolean;
};

const TOTAL_HOLES = 18;

function toStringParam(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

function sumStrokes(rows: HoleRow[], playerId: string | null) {
  if (!playerId) return null;
  let total = 0;
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") total += r.strokes;
  }
  return total;
}

function nextUnscoredHole(rows: HoleRow[], playerId: string) {
  const scored = new Set<number>();
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") {
      scored.add(r.hole_no);
    }
  }
  for (let h = 1; h <= TOTAL_HOLES; h++) {
    if (!scored.has(h)) return h;
  }
  return TOTAL_HOLES;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function MatchScoringPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = toStringParam((params as any)?.id ?? (params as any)?.matchId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [holes, setHoles] = useState<HoleRow[]>([]);

  const [holeNo, setHoleNo] = useState<number>(1);
  const [strokesInput, setStrokesInput] = useState<string>("");
  const [responding, setResponding] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  useEffect(() => {
    if (!matchId) return;

    let unsub: (() => void) | null = null;

    let handled = false;

    function handleSession(session: { user: { id: string; email?: string } } | null) {
      const sessionUser = session?.user ?? null;

      if (!sessionUser) {
        setMeId(null);
        setMeEmail(null);
        setMatch(null);
        setHoles([]);
        setStatus("Auth session missing");
        setLoading(false);
        return;
      }

      setMeId(sessionUser.id);
      setMeEmail(sessionUser.email ?? null);

      (async () => {
      try {
        setLoading(true);
        setStatus(null);

        const { data: matchData, error: matchErr } = await supabase
          .from("matches")
          .select(
            "id, creator_id, opponent_id, opponent_email, course_name, status, completed, terms_status, format, use_handicap, round_time"
          )
          .eq("id", matchId)
          .single();

        if (matchErr) {
          setStatus(matchErr.message);
          setLoading(false);
          return;
        }

        setMatch(matchData as MatchRow);

        const { data: holeData, error: holeErr } = await supabase
          .from("holes")
          .select("match_id, hole_no, player_id, strokes, locked")
          .eq("match_id", matchId);

        if (holeErr) {
          setStatus(holeErr.message);
          setLoading(false);
          return;
        }

        const rows = (holeData ?? []) as HoleRow[];
        setHoles(rows);

        const nextHole = nextUnscoredHole(rows, sessionUser.id);
        setHoleNo(nextHole);

        const existing = rows.find(
          (r) => r.player_id === sessionUser.id && r.hole_no === nextHole
        );
        setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");

        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setStatus(e?.message ?? "Failed to load match");
        setLoading(false);
      }
    })();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      handleSession(session);
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) handleSession(session);
    });

    unsub = () => subscription.unsubscribe();
    return () => { unsub?.(); };
  }, [matchId]);

  const myScoresByHole = useMemo(() => {
    const m = new Map<number, number>();
    if (!meId) return m;

    for (const r of holes) {
      if (r.player_id === meId && typeof r.strokes === "number") {
        m.set(r.hole_no, r.strokes);
      }
    }

    return m;
  }, [holes, meId]);

  const myTotal = useMemo(() => sumStrokes(holes, meId), [holes, meId]);
  const oppTotal = useMemo(
    () => sumStrokes(holes, match?.opponent_id ?? null),
    [holes, match?.opponent_id]
  );

  const opponentLabel = useMemo(
    () => match?.opponent_email || "Opponent",
    [match]
  );

  function goPrev() {
    if (!meId) return;

    const prev = Math.max(1, holeNo - 1);
    setHoleNo(prev);

    const existing = holes.find((r) => r.player_id === meId && r.hole_no === prev);
    setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    setStatus(null);
  }

  function goNext() {
    if (!meId) return;

    if (!myScoresByHole.has(holeNo)) {
      setStatus("Enter your strokes for this hole first.");
      return;
    }

    const next = Math.min(TOTAL_HOLES, holeNo + 1);
    setHoleNo(next);

    const existing = holes.find((r) => r.player_id === meId && r.hole_no === next);
    setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    setStatus(null);
  }

  async function saveHole() {
    if (!matchId || !meId) return;

    setStatus(null);

    const strokes = Number(strokesInput);
    if (!Number.isFinite(strokes) || strokes < 1 || strokes > 20) {
      setStatus("Enter a valid strokes number (1-20).");
      return;
    }

    setSaving(true);

    const { data, error } = await supabase
      .from("holes")
      .upsert(
        {
          match_id: matchId,
          hole_no: holeNo,
          player_id: meId,
          strokes,
          locked: false,
        },
        { onConflict: "match_id,hole_no,player_id" }
      )
      .select("match_id, hole_no, player_id, strokes, locked");

    setSaving(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    const saved = (data ?? []) as HoleRow[];

    setHoles((prev) => {
      const next = [...prev];
      for (const row of saved) {
        const idx = next.findIndex(
          (r) =>
            r.match_id === row.match_id &&
            r.hole_no === row.hole_no &&
            r.player_id === row.player_id
        );
        if (idx >= 0) next[idx] = row;
        else next.push(row);
      }
      return next;
    });

    if (holeNo < TOTAL_HOLES) {
      const nextHole = holeNo + 1;
      setHoleNo(nextHole);

      const existing = holes.find(
        (r) => r.player_id === meId && r.hole_no === nextHole
      );
      setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    }
  }

  const [completing, setCompleting] = useState(false);

  const allScoredByMe = myScoresByHole.size >= TOTAL_HOLES;
  const isCompleted = match?.completed === true || match?.status === "completed";
  const isActive = match?.terms_status === "accepted" || match?.status === "active";

  async function completeMatch() {
    if (!matchId || !meId) return;
    if (!confirm("Mark this match as completed? Scores will be locked.")) return;

    setCompleting(true);
    setStatus(null);

    const { error } = await supabase
      .from("matches")
      .update({ completed: true, status: "completed" })
      .eq("id", matchId);

    setCompleting(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    setMatch((prev) => prev ? { ...prev, completed: true, status: "completed" } : prev);
  }

  const [deletingMatch, setDeletingMatch] = useState(false);

  const isProposed =
    match?.status === "proposed" || match?.terms_status === "pending";
  const isCreator = meId != null && meId === match?.creator_id;
  const canDelete = isProposed && isCreator;

  const isOpponent =
    isProposed &&
    meEmail != null &&
    match?.opponent_email != null &&
    meEmail.trim().toLowerCase() === match.opponent_email.trim().toLowerCase();

  async function respondToMatch(action: "accept" | "decline") {
    setResponding(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/respond-match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        matchId,
        action,
        ...(action === "decline" && declineReason ? { reason: declineReason } : {}),
      }),
    });
    const json = await res.json();
    setResponding(false);
    if (!res.ok) {
      setStatus(json.error || "Failed to respond");
      return;
    }
    if (action === "decline") {
      router.push("/matches");
    } else {
      window.location.reload();
    }
  }

  async function deleteMatch() {
    if (!matchId || !confirm("Delete this proposed match? This cannot be undone.")) return;

    setDeletingMatch(true);

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
      setDeletingMatch(false);

      if (!res.ok) {
        setStatus(json.error || "Failed to delete match");
        return;
      }

      router.push("/matches");
    } catch (e: any) {
      setDeletingMatch(false);
      setStatus(e?.message || "Failed to delete match");
    }
  }

  if (!matchId) return <div className="p-4 text-sm text-[var(--muted)]">Missing match id.</div>;

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "75ms" }} />
          <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "150ms" }} />
        </div>
        <div className="h-48 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "225ms" }} />
        <div className="h-32 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "300ms" }} />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex items-center rounded-full bg-[var(--pine)]/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--pine)]">
            {match?.course_name ?? "Match"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Scorecard</h1>
          <div className="mt-1 text-xs text-[var(--muted)] sm:text-sm">
            Hole-by-hole scoring -- totals update automatically
          </div>
        </div>

        {canDelete && (
          <button
            type="button"
            onClick={deleteMatch}
            disabled={deletingMatch}
            className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 hover:border-red-300 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
          >
            {deletingMatch ? "Deleting..." : "Delete"}
          </button>
        )}
      </div>

      {/* Opponent: Accept / Decline challenge */}
      {isOpponent && (
        <div className="rounded-2xl border-2 border-[var(--pine)]/30 bg-gradient-to-br from-[var(--pine)]/5 to-white p-5 shadow-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--pine)]">
            Challenge Received
          </div>
          <p className="text-sm text-[var(--fg)]">
            <span className="font-semibold">{match?.creator_email || "The match creator"}</span> has challenged you to a round.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[var(--fg)]">
            <li><span className="font-medium text-[var(--muted)]">Course:</span> {match?.course_name}</li>
            <li><span className="font-medium text-[var(--muted)]">Format:</span> {match?.format === "match_play" ? "Match Play" : "Stroke Play"}</li>
            <li><span className="font-medium text-[var(--muted)]">Handicap:</span> {match?.use_handicap ? "Yes" : "No"}</li>
            {match?.round_time && (
              <li><span className="font-medium text-[var(--muted)]">Round time:</span> {new Date(match.round_time).toLocaleString()}</li>
            )}
          </ul>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => respondToMatch("accept")}
                disabled={responding}
                className="rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:shadow-none disabled:translate-y-0"
              >
                {responding ? "Responding..." : "Accept Challenge"}
              </button>
              {!showDecline ? (
                <button
                  type="button"
                  onClick={() => setShowDecline(true)}
                  disabled={responding}
                  className="rounded-xl border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--paper)] hover:border-red-200 hover:text-red-600 disabled:opacity-60"
                >
                  Decline
                </button>
              ) : null}
            </div>
            {showDecline && (
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-3">
                <div className="text-sm font-medium text-red-800">Why are you declining?</div>
                <textarea
                  className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-red-300 focus:border-red-300 focus:ring-1 focus:ring-red-200"
                  rows={2}
                  placeholder="e.g. Schedule conflict, already have a match that day..."
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => respondToMatch("decline")}
                    disabled={responding}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                  >
                    {responding ? "Declining..." : "Confirm Decline"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowDecline(false); setDeclineReason(""); }}
                    disabled={responding}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-white disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Creator: waiting indicator */}
      {isProposed && isCreator && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 px-5 py-4 text-sm text-amber-800">
          <span className="font-semibold">Waiting for response</span> -- your opponent has not yet accepted or declined this match.
        </div>
      )}

      {/* Score summary cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(() => {
          const myWins = isCompleted && myTotal != null && oppTotal != null && myTotal < oppTotal;
          const oppWins = isCompleted && myTotal != null && oppTotal != null && oppTotal < myTotal;
          const isTie = isCompleted && myTotal != null && oppTotal != null && myTotal === oppTotal;

          return (
            <>
              <div className={cx(
                "rounded-2xl border p-5",
                isCompleted && myWins
                  ? "border-emerald-300 bg-gradient-to-br from-emerald-100 to-emerald-50 ring-2 ring-emerald-300/50"
                  : "border-emerald-200/50 bg-gradient-to-br from-emerald-50/80 to-emerald-50/30"
              )}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                    You {isCompleted && myWins ? "- Winner" : isCompleted && isTie ? "- Tie" : ""}
                  </div>
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                    {myScoresByHole.size}
                  </div>
                </div>
                <div className="mt-2 text-4xl font-bold tracking-tight text-emerald-800">{myTotal ?? 0}</div>
                <div className="mt-1 truncate text-xs text-emerald-600/70">{meEmail ?? ""}</div>
              </div>

              <div className={cx(
                "rounded-2xl border p-5",
                isCompleted && oppWins
                  ? "border-slate-300 bg-gradient-to-br from-slate-100 to-slate-50 ring-2 ring-slate-300/50"
                  : "border-slate-200/50 bg-gradient-to-br from-slate-50/80 to-slate-50/30"
              )}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Opponent {isCompleted && oppWins ? "- Winner" : isCompleted && isTie ? "- Tie" : ""}
                  </div>
                </div>
                <div className="mt-2 text-4xl font-bold tracking-tight text-slate-700">{oppTotal ?? "--"}</div>
                <div className="mt-1 truncate text-xs text-slate-400">
                  {match?.opponent_id ? opponentLabel : "Not linked yet"}
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Completed banner */}
      {isCompleted && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 text-center shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Match Complete</div>
          <div className="mt-2 text-lg font-bold text-[var(--ink)]">
            {myTotal != null && oppTotal != null ? (
              myTotal < oppTotal ? "You won!" :
              myTotal > oppTotal ? "You lost." :
              "It's a tie."
            ) : (
              "Final scores are in."
            )}
          </div>
          {myTotal != null && oppTotal != null && (
            <div className="mt-1 text-sm text-[var(--muted)]">
              {myTotal} vs {oppTotal} ({Math.abs(myTotal - oppTotal)} stroke{Math.abs(myTotal - oppTotal) !== 1 ? "s" : ""} {myTotal < oppTotal ? "ahead" : myTotal > oppTotal ? "behind" : "even"})
            </div>
          )}
        </div>
      )}

      {/* Complete match button - show when all 18 holes scored and match is active */}
      {!isCompleted && allScoredByMe && isActive && (
        <div className="rounded-2xl border-2 border-[var(--pine)]/30 bg-gradient-to-br from-[var(--pine)]/5 to-white p-5 text-center">
          <div className="text-sm font-semibold text-[var(--ink)]">All 18 holes scored!</div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Your total: {myTotal} strokes. Ready to finalize?
          </div>
          <button
            type="button"
            onClick={completeMatch}
            disabled={completing}
            className="mt-4 rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
          >
            {completing ? "Completing..." : "Complete Match"}
          </button>
        </div>
      )}

      {/* Scoring input area - only show when match is not completed */}
      {!isCompleted && (
        <div className="overflow-hidden rounded-2xl border-2 border-[var(--pine)]/20 bg-gradient-to-b from-white to-[var(--paper)] shadow-sm">
          <div className="border-b border-[var(--border)] bg-[var(--pine)]/5 px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pine)] text-sm font-bold text-white">
                  {holeNo}
                </span>
                <div>
                  <div className="text-sm font-bold tracking-tight">Hole {holeNo} of {TOTAL_HOLES}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {myScoresByHole.has(holeNo) ? "Scored" : "Not scored yet"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Running total</div>
                <div className="text-lg font-bold text-[var(--pine)]">{myTotal ?? 0}</div>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your strokes</label>
                <input
                  className="mt-2 w-full rounded-xl border-2 border-[var(--border)] bg-white px-4 py-3.5 text-center text-2xl font-bold tracking-tight outline-none transition focus:border-[var(--pine)] focus:ring-2 focus:ring-[var(--pine)]/20"
                  inputMode="numeric"
                  value={strokesInput}
                  onChange={(e) => setStrokesInput(e.target.value)}
                  placeholder="0"
                />
              </div>

              <button
                className="rounded-xl bg-[var(--pine)] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:shadow-none disabled:translate-y-0"
                onClick={saveHole}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            <div className="mt-2 text-[11px] text-[var(--muted)]">
              Save to advance. Next is locked until scored.
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] hover:border-[var(--pine)]/30 disabled:opacity-40"
                onClick={goPrev}
                disabled={holeNo <= 1}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Previous
              </button>

              <div className="text-xs font-medium text-[var(--muted)]">
                {myScoresByHole.size} of {TOTAL_HOLES} scored
              </div>

              <button
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] hover:border-[var(--pine)]/30 disabled:opacity-40"
                onClick={goNext}
                disabled={!myScoresByHole.has(holeNo) || holeNo >= TOTAL_HOLES}
              >
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hole grid */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold tracking-tight">Your Holes</div>
          <div className="text-xs text-[var(--muted)]">{myScoresByHole.size}/{TOTAL_HOLES} complete</div>
        </div>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-9 sm:gap-2.5">
          {Array.from({ length: TOTAL_HOLES }, (_, i) => i + 1).map((h) => {
            const v = myScoresByHole.get(h);
            const isCurrent = !isCompleted && h === holeNo;
            const isScored = v != null;
            return (
              <button
                key={h}
                type="button"
                onClick={() => {
                  if (isCompleted) return;
                  setHoleNo(h);
                  const existing = holes.find((r) => r.player_id === meId && r.hole_no === h);
                  setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
                  setStatus(null);
                }}
                disabled={isCompleted}
                className={cx(
                  "rounded-xl p-2 text-center transition sm:p-2.5",
                  isCurrent && "ring-2 ring-[var(--pine)] bg-[var(--pine)]/10 border-[var(--pine)]/30 shadow-sm",
                  !isCurrent && isScored && "border border-emerald-200/60 bg-emerald-50/50",
                  !isCurrent && !isScored && "border border-[var(--border)] bg-white/60",
                  !isCompleted && !isCurrent && isScored && "hover:bg-emerald-50",
                  !isCompleted && !isCurrent && !isScored && "hover:bg-white",
                  isCurrent && "border border-[var(--pine)]/30",
                  !isCompleted && !isCurrent && "cursor-pointer",
                  isCompleted && "cursor-default"
                )}
              >
                <div className={cx(
                  "text-[10px] font-medium sm:text-xs",
                  isCurrent ? "text-[var(--pine)]" : "text-[var(--muted)]"
                )}>
                  {h}
                </div>
                <div className={cx(
                  "text-sm font-bold sm:text-base",
                  isCurrent && "text-[var(--pine)]",
                  !isCurrent && isScored && "text-emerald-700",
                  !isCurrent && !isScored && "text-[var(--muted)]"
                )}>
                  {v ?? "--"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {status && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {status}
        </div>
      )}
    </div>
  );
}
