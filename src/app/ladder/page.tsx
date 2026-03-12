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
  updated_at: string;
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

export default function LadderPage() {
  const router = useRouter();
  const [meId, setMeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"gross" | "net">("gross");

  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [records, setRecords] = useState<Record<string, WLRecord>>({});
  const [activeChallenges, setActiveChallenges] = useState<ActiveChallenge[]>([]);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [initing, setIniting] = useState(false);
  const [challenging, setChallenging] = useState<string | null>(null);
  const [challengeDeadline, setChallengeDeadline] = useState("");
  const [showDeadlinePicker, setShowDeadlinePicker] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let handled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      setMeId(session?.user?.id ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) setMeId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchLadder() {
    setLoading(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();

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
      // Merge any new profiles
      if (json.profiles) {
        setProfiles((prev) => ({ ...prev, ...json.profiles }));
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    if (meId) fetchLadder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  const filtered = rankings.filter((r) => r.type === tab);
  const myRanking = filtered.find((r) => r.user_id === meId);
  const isInLadder = Boolean(myRanking);
  const isEmpty = rankings.length === 0;

  async function postAction(body: any) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return fetch("/api/ladder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function joinLadder() {
    setJoining(true);
    setStatus(null);
    const res = await postAction({ action: "join" });
    const json = await res.json();
    if (!res.ok) setStatus(json.error ?? "Failed to join");
    else await fetchLadder();
    setJoining(false);
  }

  async function initLadder() {
    setIniting(true);
    setStatus(null);
    const res = await postAction({ action: "init" });
    const json = await res.json();
    if (!res.ok) setStatus(json.error ?? "Failed to initialize");
    else await fetchLadder();
    setIniting(false);
  }

  // Check if either player already has an active challenge
  const myActiveChallenge = activeChallenges.find(
    (c) => c.challenger_id === meId || c.opponent_id === meId
  );

  function canChallenge(target: Ranking) {
    if (!myRanking) return false;
    if (target.user_id === meId) return false;
    // Only one active challenge at a time per player
    if (myActiveChallenge) return false;
    // Check if target has an active challenge
    const targetHasChallenge = activeChallenges.some(
      (c) => c.challenger_id === target.user_id || c.opponent_id === target.user_id
    );
    if (targetHasChallenge) return false;
    // Can challenge up to 3 spots above
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

  const trophyColors: Record<number, string> = {
    1: "text-yellow-500",
    2: "text-gray-400",
    3: "text-amber-700",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ladder</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Challenge players above you to climb the ranks.
        </p>
      </div>

      {/* Active challenge banner */}
      {myActiveChallenge && (
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
      )}

      {/* How it works */}
      <div className="rounded-[6px] border border-[var(--border)] bg-white/60 p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)] mb-3">How it works</div>
        <div className="space-y-2.5 text-sm text-[var(--ink)]">
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">1</span>
            <span>Challenge anyone up to <span className="font-medium">3 spots above</span> you. Set a deadline (max 14 days).</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">2</span>
            <span>Each player plays their own round at <span className="font-medium">any course, any tee</span>. Scores are compared by handicap differential.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">3</span>
            <span>Lower differential wins. The winner <span className="font-medium">swaps positions</span>. Decline a challenge and you drop a spot.</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-[6px] border border-[var(--border)] bg-white/60 p-1">
        {(["gross", "net"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-[4px] px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? "bg-[var(--pine)] text-[var(--paper)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t === "gross" ? "Gross" : "Net"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted)]">
          Loading ladder...
        </div>
      ) : isEmpty ? (
        <div className="space-y-4 rounded-[6px] border border-[var(--border)] bg-white/60 p-8 text-center">
          <p className="text-sm text-[var(--muted)]">
            The ladder hasn&apos;t been set up yet.
          </p>
          <button
            onClick={initLadder}
            disabled={initing}
            className="rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] disabled:opacity-60"
          >
            {initing ? "Initializing..." : "Initialize Ladder"}
          </button>
        </div>
      ) : (
        <>
          {/* Join button */}
          {!isInLadder && (
            <div className="rounded-[6px] border border-emerald-200/60 bg-emerald-50/50 p-4 text-center">
              <p className="text-sm text-emerald-800">
                You&apos;re not in the ladder yet.
              </p>
              <button
                onClick={joinLadder}
                disabled={joining}
                className="mt-3 rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] disabled:opacity-60"
              >
                {joining ? "Joining..." : "Join Ladder"}
              </button>
            </div>
          )}

          {/* Challengeable players */}
          {isInLadder && !myActiveChallenge && (() => {
            const challengeable = filtered.filter((r) => canChallenge(r));
            if (challengeable.length === 0) return (
              <div className="rounded-[6px] border border-dashed border-[var(--border)] bg-white/60 p-4 text-center">
                <div className="text-sm font-medium text-[var(--ink)]">
                  {myRanking?.position === 1 ? "You're #1 — no one to challenge!" : "No one available to challenge right now"}
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {myRanking?.position === 1 ? "Defend your spot." : "All nearby players may already be in active challenges."}
                </p>
              </div>
            );
            return (
              <section className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--gold)]">You can challenge</div>
                <div className="space-y-2">
                  {challengeable.map((r) => {
                    const prof = profiles[r.user_id];
                    const rec = records[r.user_id];
                    const name = prof?.display_name || "Unknown";
                    const spotsAbove = myRanking!.position - r.position;
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
                          <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm sm:h-10 sm:w-10">
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
                            <div className="text-xs font-medium text-[var(--ink)]">Deadline (max 14 days)</div>
                            <div className="flex gap-2">
                              <input
                                type="date"
                                className="flex-1 rounded-[6px] border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--pine)]/40"
                                value={challengeDeadline}
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
              </section>
            );
          })()}

          {/* Your position */}
          {myRanking && (
            <div className="flex items-center gap-3 rounded-[6px] border border-[var(--pine)]/30 bg-[var(--pine)]/5 px-4 py-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                {myRanking.position <= 3 ? (
                  <span className="text-lg font-bold">
                    {myRanking.position === 1 ? "\u{1F947}" : myRanking.position === 2 ? "\u{1F948}" : "\u{1F949}"}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-[var(--pine)]">{myRanking.position}</span>
                )}
              </div>
              <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm sm:h-10 sm:w-10">
                {profiles[meId!]?.avatar_url ? (
                  <img src={profiles[meId!].avatar_url!} alt="You" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-xs font-semibold">{initials(profiles[meId!]?.display_name || "You")}</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--ink)]">{profiles[meId!]?.display_name || "You"}</span>
                  <span className="rounded-full bg-[var(--pine)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--pine)]">You</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] sm:gap-2 sm:text-xs">
                  {profiles[meId!]?.handicap_index != null && <span>HCP {profiles[meId!].handicap_index}</span>}
                  {records[meId!] && (
                    <>
                      {profiles[meId!]?.handicap_index != null && <span className="text-[var(--border)]">&middot;</span>}
                      <span>{records[meId!].wins}W - {records[meId!].losses}L</span>
                    </>
                  )}
                </div>
              </div>
              {myActiveChallenge && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700 border border-amber-200/60">
                  In challenge
                </span>
              )}
            </div>
          )}

          {/* Full rankings */}
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Full Rankings</div>
            <div className="space-y-1.5">
              {filtered.map((r) => {
                const prof = profiles[r.user_id];
                const rec = records[r.user_id];
                const name = prof?.display_name || "Unknown";
                const isMe = r.user_id === meId;

                const Wrapper = isMe ? "div" as const : Link;
                const wrapperProps = isMe ? {} : { href: `/players/${r.user_id}` };

                return (
                  <Wrapper
                    key={r.id}
                    {...wrapperProps as any}
                    className={`flex items-center gap-2 rounded-[6px] border px-3 py-2.5 transition sm:gap-3 sm:px-4 sm:py-3 ${
                      isMe
                        ? "border-[var(--pine)]/30 bg-[var(--pine)]/5"
                        : "border-[var(--border)] bg-white/60 hover:border-[var(--pine)]/20 hover:shadow-sm cursor-pointer"
                    }`}
                  >
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
                    <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm sm:h-10 sm:w-10">
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
                        {isMe && (
                          <span className="rounded-full bg-[var(--pine)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--pine)]">You</span>
                        )}
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
                  </Wrapper>
                );
              })}
            </div>
          </section>
        </>
      )}

      {status && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {status}
        </div>
      )}
    </div>
  );
}
