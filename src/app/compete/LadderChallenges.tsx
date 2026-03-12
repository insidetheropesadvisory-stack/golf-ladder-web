"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type Ranking = {
  id: string;
  user_id: string;
  position: number;
  type: "net" | "gross";
};

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

type WLRecord = { wins: number; losses: number };

type ActiveChallenge = {
  id: string;
  challenger_id: string;
  opponent_id: string;
  status: string;
  deadline: string;
};

export default function LadderChallenges() {
  const router = useRouter();
  const [meId, setMeId] = useState<string | null>(null);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [records, setRecords] = useState<Record<string, WLRecord>>({});
  const [activeChallenges, setActiveChallenges] = useState<ActiveChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [challenging, setChallenging] = useState<string | null>(null);
  const [challengeDeadline, setChallengeDeadline] = useState("");
  const [showDeadlinePicker, setShowDeadlinePicker] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setMeId(session?.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!meId) return;
    async function load() {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const [ladderRes, challengesRes] = await Promise.all([
        fetch("/api/ladder", { headers }),
        fetch("/api/ladder-matches", { headers }),
      ]);

      if (ladderRes.ok) {
        const json = await ladderRes.json();
        setRankings(json.rankings ?? []);
        setProfiles(json.profiles ?? {});
        setRecords(json.records ?? {});
      }
      if (challengesRes.ok) {
        const json = await challengesRes.json();
        setActiveChallenges(
          (json.challenges ?? []).filter((c: any) => c.status === "pending" || c.status === "accepted")
        );
        if (json.profiles) setProfiles((prev) => ({ ...prev, ...json.profiles }));
      }
      setLoading(false);
    }
    load();
  }, [meId]);

  const filtered = rankings.filter((r) => r.type === "gross");
  const myRanking = filtered.find((r) => r.user_id === meId);
  const myActiveChallenge = activeChallenges.find(
    (c) => c.challenger_id === meId || c.opponent_id === meId
  );

  function canChallenge(target: Ranking) {
    if (!myRanking) return false;
    if (target.user_id === meId) return false;
    if (myActiveChallenge) return false;
    const targetHasChallenge = activeChallenges.some(
      (c) => c.challenger_id === target.user_id || c.opponent_id === target.user_id
    );
    if (targetHasChallenge) return false;
    return (
      myRanking.position > target.position &&
      myRanking.position - target.position <= 3
    );
  }

  async function sendChallenge(opponentId: string) {
    if (!challengeDeadline) { setStatus("Pick a deadline"); return; }
    setChallenging(opponentId);
    setStatus(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/ladder-matches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ action: "create", opponent_id: opponentId, deadline: challengeDeadline }),
    });
    const json = await res.json();
    if (!res.ok) { setStatus(json.error ?? "Failed to create challenge"); setChallenging(null); return; }
    setChallenging(null);
    setShowDeadlinePicker(null);
    setChallengeDeadline("");
    router.push(`/ladder/challenge/${json.challenge.id}`);
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-14 animate-pulse rounded-[6px] bg-black/[0.03]" />
        <div className="h-14 animate-pulse rounded-[6px] bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
      </div>
    );
  }

  if (!myRanking) {
    return (
      <div className="rounded-[6px] border border-dashed border-[var(--border)] bg-white/60 p-4 text-center">
        <div className="text-sm text-[var(--muted)]">Join the ladder to start challenging.</div>
        <Link href="/ladder" className="btn-outline-gold mt-2 inline-flex text-[12px]">View Ladder</Link>
      </div>
    );
  }

  // Active challenge
  if (myActiveChallenge) {
    return (
      <Link
        href={`/ladder/challenge/${myActiveChallenge.id}`}
        className="block rounded-[6px] border border-amber-200/60 bg-amber-50/50 px-4 py-3 transition hover:shadow-sm"
      >
        <div className="flex items-center justify-between">
          <div className="text-sm text-amber-800">
            <span className="font-bold">Active challenge</span> — deadline {myActiveChallenge.deadline}
            {myActiveChallenge.status === "pending" && myActiveChallenge.opponent_id === meId && (
              <span className="ml-1.5 rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-semibold text-white">Action needed</span>
            )}
          </div>
          <span className="text-xs font-medium text-[var(--pine)]">View &rarr;</span>
        </div>
      </Link>
    );
  }

  const challengeable = filtered.filter((r) => canChallenge(r));

  if (challengeable.length === 0) {
    return (
      <div className="rounded-[6px] border border-dashed border-[var(--border)] bg-white/60 p-4 text-center">
        <div className="text-sm font-medium text-[var(--ink)]">
          {myRanking.position === 1 ? "You're #1 — no one to challenge!" : "No one available to challenge right now"}
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {myRanking.position === 1 ? "Defend your spot." : "All nearby players may already be in active challenges."}
        </p>
      </div>
    );
  }

  const trophyColors: Record<number, string> = {
    1: "text-yellow-500",
    2: "text-gray-400",
    3: "text-amber-700",
  };

  return (
    <div className="space-y-2">
      {status && (
        <div className="rounded-[6px] bg-red-50 px-3 py-2 text-xs text-red-700">{status}</div>
      )}
      {challengeable.map((r) => {
        const prof = profiles[r.user_id];
        const rec = records[r.user_id];
        const name = prof?.display_name || "Unknown";
        const spotsAbove = myRanking.position - r.position;
        return (
          <div key={r.id} className="space-y-2">
            <div className="flex items-center gap-2 rounded-[6px] border-2 border-[var(--gold)]/30 bg-[var(--gold)]/5 px-3 py-3 sm:gap-3 sm:px-4">
              {/* Position */}
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                {r.position <= 3 ? (
                  <span className={`text-lg font-bold ${trophyColors[r.position] ?? ""}`}>
                    {r.position === 1 ? "\u{1F947}" : r.position === 2 ? "\u{1F948}" : "\u{1F949}"}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-[var(--muted)]">{r.position}</span>
                )}
              </div>

              {/* Avatar */}
              <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] shadow-sm sm:h-10 sm:w-10">
                {prof?.avatar_url ? (
                  <img src={prof.avatar_url} alt={name} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-xs font-semibold">{initials(name)}</div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--ink)]">{name}</span>
                  <span className="rounded-full bg-[var(--gold)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--gold)]">
                    {spotsAbove} spot{spotsAbove !== 1 ? "s" : ""} above
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] sm:gap-2 sm:text-xs">
                  {prof?.handicap_index != null && <span>HCP {prof.handicap_index}</span>}
                  {rec && (
                    <>
                      {prof?.handicap_index != null && <span className="text-[var(--border)]">&middot;</span>}
                      <span>{rec.wins}W - {rec.losses}L</span>
                    </>
                  )}
                </div>
              </div>

              {/* Challenge CTA */}
              <button
                onClick={() => {
                  if (showDeadlinePicker === r.user_id) {
                    setShowDeadlinePicker(null);
                  } else {
                    setShowDeadlinePicker(r.user_id);
                    const d = new Date();
                    d.setDate(d.getDate() + 7);
                    setChallengeDeadline(d.toISOString().split("T")[0]);
                  }
                }}
                className="btn-gold flex-shrink-0 !px-4 !py-2 !text-sm"
              >
                Challenge
              </button>
            </div>

            {/* Deadline picker */}
            {showDeadlinePicker === r.user_id && (
              <div className="rounded-[6px] border border-[var(--gold)]/20 bg-[var(--gold)]/5 p-3 space-y-2">
                <div className="text-xs font-medium text-[var(--ink)]">Deadline (7–14 days)</div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    className="flex-1 rounded-[6px] border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--pine)]/40"
                    value={challengeDeadline}
                    min={(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split("T")[0]; })()}
                    max={(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().split("T")[0]; })()}
                    onChange={(e) => setChallengeDeadline(e.target.value)}
                  />
                  <button
                    onClick={() => sendChallenge(r.user_id)}
                    disabled={challenging === r.user_id || !challengeDeadline}
                    className="btn-gold !py-2 disabled:opacity-40"
                  >
                    {challenging === r.user_id ? "Sending..." : "Send Challenge"}
                  </button>
                  <button
                    onClick={() => { setShowDeadlinePicker(null); setChallengeDeadline(""); }}
                    className="btn-outline-gold !py-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
