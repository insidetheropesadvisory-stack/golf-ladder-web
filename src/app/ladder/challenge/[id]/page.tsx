"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type Challenge = {
  id: string;
  challenger_id: string;
  opponent_id: string;
  status: string;
  deadline: string;
  winner_id: string | null;
  challenger_differential: number | null;
  opponent_differential: number | null;
  created_at: string;
};

type Round = {
  id: string;
  challenge_id: string;
  user_id: string;
  course_name: string;
  tee_name: string | null;
  gross_score: number | null;
  differential: number | null;
  completed: boolean;
};

type Profile = { id: string; display_name: string | null; avatar_url: string | null; handicap_index: number | null };

export default function ChallengeDetailPage() {
  const params = useParams();
  const challengeId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [positions, setPositions] = useState<Record<string, number>>({});

  const [counterDeadline, setCounterDeadline] = useState("");
  const [showCounter, setShowCounter] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setMeId(session.user.id);
    });
  }, []);

  async function fetchChallenge() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setError("Not signed in"); setLoading(false); return; }

    const res = await fetch(`/api/ladder-matches/${challengeId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to load");
      setLoading(false);
      return;
    }

    const json = await res.json();
    setChallenge(json.challenge);
    setRounds(json.rounds ?? []);
    setProfiles(json.profiles ?? {});
    setPositions(json.positions ?? {});
    setLoading(false);
  }

  useEffect(() => {
    if (challengeId && meId) fetchChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, meId]);

  async function postAction(body: any) {
    setActionLoading(true);
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/ladder-matches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Action failed");
    else await fetchChallenge();
    setActionLoading(false);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-black/[0.03]" />
        <div className="h-48 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm text-[var(--muted)]">{error || "Challenge not found"}</div>
        <Link href="/ladder" className="mt-3 inline-block text-sm text-[var(--pine)] underline">Back to ladder</Link>
      </div>
    );
  }

  const isChallenger = meId === challenge.challenger_id;
  const isOpponent = meId === challenge.opponent_id;
  const challengerProfile = profiles[challenge.challenger_id];
  const opponentProfile = profiles[challenge.opponent_id];
  const challengerName = challengerProfile?.display_name || "Challenger";
  const opponentName = opponentProfile?.display_name || "Opponent";

  const myRound = rounds.find((r) => r.user_id === meId);
  const theirRound = rounds.find((r) => r.user_id !== meId);

  const isPending = challenge.status === "pending";
  const isAccepted = challenge.status === "accepted";
  const isCompleted = challenge.status === "completed";
  const isDeclined = challenge.status === "declined";

  const deadlinePassed = new Date() > new Date(challenge.deadline + "T23:59:59");

  // Both players have completed their rounds
  const bothRoundsComplete = myRound?.completed === true && theirRound?.completed === true;

  // For non-completed challenges, hide the opponent's score data
  function shouldHideScore(playerId: string): boolean {
    if (isCompleted) return false; // Challenge resolved — show everything
    if (playerId === meId) return false; // Always show own scores
    return !bothRoundsComplete; // Hide opponent until both finish
  }

  function renderPlayerCard(playerId: string, round: Round | undefined, label: string) {
    const prof = profiles[playerId];
    const name = prof?.display_name || "Unknown";
    const pos = positions[playerId];
    const hideScore = shouldHideScore(playerId);

    return (
      <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] shadow-sm">
            {prof?.avatar_url ? (
              <img src={prof.avatar_url} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs font-semibold">{initials(name)}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--ink)] truncate">{name}</div>
            <div className="text-xs text-[var(--muted)]">
              {label}{pos ? ` \u00b7 #${pos}` : ""}
              {prof?.handicap_index != null ? ` \u00b7 HCP ${prof.handicap_index}` : ""}
            </div>
          </div>
        </div>

        {hideScore && round ? (
          <div className="mt-3 rounded-lg bg-[var(--pine)] p-3 text-center">
            <div className="flex items-center justify-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--gold)]">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              <span className="text-[12px] font-bold text-[var(--gold)]">Awaiting opponent</span>
            </div>
            <div className="mt-1 text-[10px] text-[var(--paper)]/50">Scores revealed when both players finish</div>
          </div>
        ) : hideScore && !round ? (
          isAccepted ? (
            <div className="mt-3 rounded-lg bg-[var(--pine)] p-3 text-center">
              <div className="flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--gold)]">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <span className="text-[12px] font-bold text-[var(--gold)]">Awaiting opponent</span>
              </div>
              <div className="mt-1 text-[10px] text-[var(--paper)]/50">No round submitted yet</div>
            </div>
          ) : null
        ) : round ? (
          <div className="mt-3 rounded-lg border border-[var(--border)]/50 bg-[var(--paper-2)] p-3">
            <div className="text-xs text-[var(--muted)]">{round.course_name}{round.tee_name ? ` \u00b7 ${round.tee_name}` : ""}</div>
            {round.completed ? (
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-lg font-bold tabular-nums text-[var(--ink)]">{round.gross_score}</span>
                <span className="text-sm font-semibold tabular-nums text-[var(--pine)]">{round.differential?.toFixed(1)} diff</span>
              </div>
            ) : (
              <div className="mt-1 text-sm text-amber-600 font-medium">Scoring in progress...</div>
            )}
          </div>
        ) : isAccepted ? (
          <div className="mt-3 text-sm text-[var(--muted)]">No round submitted yet</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/ladder" className="text-sm text-[var(--pine)] font-medium">&larr; Ladder</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Ladder Challenge</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {challengerName} vs {opponentName}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Status badge */}
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          isCompleted ? "bg-[var(--pine)]/10 text-[var(--pine)]" :
          isDeclined ? "bg-red-50 text-red-600" :
          isAccepted ? "bg-emerald-50 text-emerald-700" :
          "bg-amber-50 text-amber-700"
        }`}>
          {challenge.status.charAt(0).toUpperCase() + challenge.status.slice(1)}
        </span>
        <span className="text-xs text-[var(--muted)]">Deadline: {challenge.deadline}</span>
        {deadlinePassed && !isCompleted && !isDeclined && (
          <span className="text-xs text-red-600 font-medium">Expired</span>
        )}
      </div>

      {/* Result banner */}
      {isCompleted && (
        <div className={`rounded-2xl border p-5 text-center ${
          challenge.winner_id === meId
            ? "border-emerald-200 bg-emerald-50/50"
            : challenge.winner_id === null
            ? "border-amber-200 bg-amber-50/50"
            : "border-red-200 bg-red-50/50"
        }`}>
          <div className="text-lg font-bold text-[var(--ink)]">
            {challenge.winner_id === null
              ? "Tied!"
              : challenge.winner_id === meId
              ? "You won!"
              : `${profiles[challenge.winner_id]?.display_name || "Opponent"} won!`
            }
          </div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            {challenge.challenger_differential?.toFixed(1)} vs {challenge.opponent_differential?.toFixed(1)} differential
          </div>
        </div>
      )}

      {/* Player cards */}
      <div className="space-y-3">
        {renderPlayerCard(
          challenge.challenger_id,
          rounds.find((r) => r.user_id === challenge.challenger_id),
          "Challenger"
        )}
        {renderPlayerCard(
          challenge.opponent_id,
          rounds.find((r) => r.user_id === challenge.opponent_id),
          "Defender"
        )}
      </div>

      {/* Actions */}
      {isPending && isOpponent && !deadlinePassed && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <button
              onClick={() => postAction({ action: "accept", challenge_id: challengeId })}
              disabled={actionLoading}
              className="flex-1 rounded-xl bg-[var(--pine)] py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md disabled:opacity-40"
            >
              {actionLoading ? "..." : "Accept"}
            </button>
            <button
              onClick={() => postAction({ action: "decline", challenge_id: challengeId })}
              disabled={actionLoading}
              className="flex-1 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-40"
            >
              {actionLoading ? "..." : "Decline"}
            </button>
          </div>

          <button
            onClick={() => setShowCounter(!showCounter)}
            className="w-full text-center text-xs text-[var(--pine)] font-medium underline"
          >
            {showCounter ? "Hide" : "Request a different deadline"}
          </button>

          {showCounter && (
            <div className="flex gap-2">
              <input
                type="date"
                className="flex-1 rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40"
                value={counterDeadline}
                onChange={(e) => setCounterDeadline(e.target.value)}
              />
              <button
                onClick={() => {
                  if (counterDeadline) postAction({ action: "counter", challenge_id: challengeId, deadline: counterDeadline });
                }}
                disabled={actionLoading || !counterDeadline}
                className="rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md disabled:opacity-40"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}

      {isPending && isChallenger && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3 text-sm text-amber-800">
          Waiting for {opponentName} to respond...
        </div>
      )}

      {/* Submit round button */}
      {isAccepted && !myRound && !deadlinePassed && (
        <Link
          href={`/ladder/challenge/${challengeId}/submit`}
          className="block rounded-xl bg-[var(--pine)] px-6 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
        >
          Submit your round
        </Link>
      )}

      {/* Continue scoring */}
      {isAccepted && myRound && !myRound.completed && (
        <Link
          href={`/ladder/challenge/${challengeId}/score/${myRound.id}`}
          className="block rounded-xl bg-[var(--gold)] px-6 py-3 text-center text-sm font-bold text-[var(--pine)] shadow-sm transition hover:shadow-md hover:-translate-y-px"
        >
          Continue scoring
        </Link>
      )}
    </div>
  );
}
