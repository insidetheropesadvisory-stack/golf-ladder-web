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

export default function LadderPage() {
  const router = useRouter();
  const [meId, setMeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"gross" | "net">("gross");

  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [records, setRecords] = useState<Record<string, WLRecord>>({});

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [initing, setIniting] = useState(false);
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

    const res = await fetch("/api/ladder", {
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {},
    });

    if (res.ok) {
      const json = await res.json();
      setRankings(json.rankings ?? []);
      setProfiles(json.profiles ?? {});
      setRecords(json.records ?? {});
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

  function canChallenge(target: Ranking) {
    if (!myRanking) return false;
    if (target.user_id === meId) return false;
    // Can challenge up to 3 spots above
    return (
      myRanking.position > target.position &&
      myRanking.position - target.position <= 3
    );
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

      {/* How it works */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)] mb-3">How it works</div>
        <div className="space-y-2.5 text-sm text-[var(--ink)]">
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">1</span>
            <span>Your starting position is based on your <span className="font-medium">handicap index</span> — lower handicaps rank higher.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">2</span>
            <span>You can challenge anyone up to <span className="font-medium">3 spots above</span> your current position.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">3</span>
            <span>Win a challenge and you <span className="font-medium">swap positions</span> with your opponent. Lose and you stay put.</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-white/60 p-1">
        {(["gross", "net"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
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
        <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
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
            <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/50 p-4 text-center">
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

          {/* Rankings list */}
          <div className="space-y-2">
            {filtered.map((r) => {
              const prof = profiles[r.user_id];
              const rec = records[r.user_id];
              const name = prof?.display_name || "Unknown";
              const isMe = r.user_id === meId;

              const Wrapper = isMe ? "div" as const : Link;
              const wrapperProps = isMe
                ? {}
                : { href: `/players/${r.user_id}` };

              return (
                <Wrapper
                  key={r.id}
                  {...wrapperProps as any}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition sm:gap-3 sm:px-4 sm:py-3 ${
                    isMe
                      ? "border-[var(--pine)]/30 bg-[var(--pine)]/5"
                      : "border-[var(--border)] bg-white/60 hover:border-[var(--pine)]/20 hover:shadow-sm cursor-pointer"
                  }`}
                >
                  {/* Position */}
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                    {r.position <= 3 ? (
                      <span className={`text-lg font-bold ${trophyColors[r.position] ?? ""}`}>
                        {r.position === 1 ? "🥇" : r.position === 2 ? "🥈" : "🥉"}
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-[var(--muted)]">
                        {r.position}
                      </span>
                    )}
                  </div>

                  {/* Avatar */}
                  <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm sm:h-10 sm:w-10">
                    {prof?.avatar_url ? (
                      <img
                        src={prof.avatar_url}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-xs font-semibold">
                        {initials(name)}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--ink)]">
                        {name}
                      </span>
                      {isMe && (
                        <span className="rounded-full bg-[var(--pine)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--pine)]">
                          You
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] sm:gap-2 sm:text-xs">
                      {prof?.handicap_index != null && (
                        <span>HCP {prof.handicap_index}</span>
                      )}
                      {rec && (
                        <>
                          {prof?.handicap_index != null && (
                            <span className="text-[var(--border)]">&middot;</span>
                          )}
                          <span>
                            {rec.wins}W - {rec.losses}L
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Challenge button */}
                  {canChallenge(r) && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(
                          `/matches/new?opponent=${r.user_id}&ladder=true`
                        );
                      }}
                      className="flex-shrink-0 rounded-lg border border-[var(--pine)]/30 bg-[var(--pine)]/5 px-2 py-1 text-[11px] font-semibold text-[var(--pine)] transition hover:bg-[var(--pine)]/10 hover:shadow-sm sm:rounded-xl sm:px-3 sm:py-1.5 sm:text-xs"
                    >
                      Challenge
                    </button>
                  )}
                </Wrapper>
              );
            })}
          </div>
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
