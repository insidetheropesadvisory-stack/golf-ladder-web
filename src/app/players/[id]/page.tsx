"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

type ClubInfo = {
  id: string;
  name: string;
};

type MatchRecord = {
  id: string;
  course_name: string;
  creator_id: string;
  opponent_id: string | null;
  status: string;
  completed: boolean;
  round_time: string | null;
};

type HoleRow = {
  match_id: string;
  player_id: string;
  strokes: number | null;
};

function toStringParam(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

function computeRecord(
  playerId: string,
  matches: MatchRecord[],
  holesByMatch: Record<string, HoleRow[]>
) {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const m of matches) {
    if (!m.completed) continue;

    const holes = holesByMatch[m.id] ?? [];
    const opponentId = m.creator_id === playerId ? m.opponent_id : m.creator_id;
    if (!opponentId) continue;

    let myTotal = 0;
    let oppTotal = 0;
    let myCount = 0;
    let oppCount = 0;

    for (const h of holes) {
      if (h.strokes == null) continue;
      if (h.player_id === playerId) {
        myTotal += h.strokes;
        myCount++;
      } else if (h.player_id === opponentId) {
        oppTotal += h.strokes;
        oppCount++;
      }
    }

    // Need at least some scored holes from both players
    if (myCount === 0 || oppCount === 0) continue;

    if (myTotal < oppTotal) wins++;
    else if (myTotal > oppTotal) losses++;
    else ties++;
  }

  return { wins, losses, ties };
}

export default function PlayerProfilePage() {
  const params = useParams();
  const playerId = toStringParam((params as any)?.id);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clubs, setClubs] = useState<ClubInfo[]>([]);
  const [record, setRecord] = useState({ wins: 0, losses: 0, ties: 0 });
  const [recentMatches, setRecentMatches] = useState<
    { id: string; course_name: string; result: "win" | "loss" | "tie" | "pending"; opponent_name: string | null; round_time: string | null }[]
  >([]);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) return;

    let handled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      setMeId(session?.user?.id ?? null);
      loadPlayer();
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) {
        setMeId(session?.user?.id ?? null);
        loadPlayer();
      }
    });

    return () => subscription.unsubscribe();
  }, [playerId]);

  async function loadPlayer() {
    if (!playerId) return;
    setLoading(true);

    try {
      // Fetch profile
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, handicap_index")
        .eq("id", playerId)
        .single();

      if (profErr) {
        setProfile(null);
        setLoading(false);
        return;
      }
      setProfile(prof as Profile);

      // Fetch clubs
      const { data: memData } = await supabase
        .from("club_memberships")
        .select("club_id, clubs(id, name)")
        .eq("user_id", playerId);

      if (memData) {
        const clubList: ClubInfo[] = [];
        for (const r of memData as any[]) {
          const c = r.clubs;
          if (c) clubList.push({ id: String(c.id), name: String(c.name) });
        }
        setClubs(clubList);
      }

      // Fetch completed matches
      const { data: matchData } = await supabase
        .from("matches")
        .select("id, course_name, creator_id, opponent_id, status, completed, round_time")
        .or(`creator_id.eq.${playerId},opponent_id.eq.${playerId}`)
        .order("round_time", { ascending: false, nullsFirst: false });

      const matches = (matchData ?? []) as MatchRecord[];

      // Fetch holes for completed matches
      const completedIds = matches.filter((m) => m.completed).map((m) => m.id);
      let holesByMatch: Record<string, HoleRow[]> = {};

      if (completedIds.length > 0) {
        const { data: holesData } = await supabase
          .from("holes")
          .select("match_id, player_id, strokes")
          .in("match_id", completedIds);

        if (holesData) {
          for (const h of holesData as HoleRow[]) {
            if (!holesByMatch[h.match_id]) holesByMatch[h.match_id] = [];
            holesByMatch[h.match_id].push(h);
          }
        }
      }

      const rec = computeRecord(playerId, matches, holesByMatch);
      setRecord(rec);

      // Build recent matches list (up to 10)
      const opponentIds = new Set<string>();
      for (const m of matches) {
        const oppId = m.creator_id === playerId ? m.opponent_id : m.creator_id;
        if (oppId) opponentIds.add(oppId);
      }

      let oppProfiles: Record<string, string> = {};
      if (opponentIds.size > 0) {
        const { data: oppData } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", Array.from(opponentIds));

        if (oppData) {
          for (const p of oppData as any[]) {
            oppProfiles[String(p.id)] = p.display_name || "Unknown";
          }
        }
      }

      const recent = matches.slice(0, 10).map((m) => {
        const oppId = m.creator_id === playerId ? m.opponent_id : m.creator_id;
        let result: "win" | "loss" | "tie" | "pending" = "pending";

        if (m.completed && oppId) {
          const holes = holesByMatch[m.id] ?? [];
          let myTotal = 0, oppTotal = 0, myCount = 0, oppCount = 0;
          for (const h of holes) {
            if (h.strokes == null) continue;
            if (h.player_id === playerId) { myTotal += h.strokes; myCount++; }
            else if (h.player_id === oppId) { oppTotal += h.strokes; oppCount++; }
          }
          if (myCount > 0 && oppCount > 0) {
            result = myTotal < oppTotal ? "win" : myTotal > oppTotal ? "loss" : "tie";
          }
        }

        return {
          id: m.id,
          course_name: m.course_name,
          result,
          opponent_name: oppId ? (oppProfiles[oppId] || "Unknown") : null,
          round_time: m.round_time,
        };
      });

      setRecentMatches(recent);
      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setLoading(false);
    }
  }

  if (!playerId) {
    return <div className="p-4 text-sm text-[var(--muted)]">Missing player id.</div>;
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 animate-pulse rounded-full bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)] border border-[var(--border)]" />
          <div className="space-y-2 flex-1">
            <div className="h-6 w-48 animate-pulse rounded-lg bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)] border border-[var(--border)]" style={{ animationDelay: "75ms" }} />
            <div className="h-4 w-32 animate-pulse rounded-lg bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)] border border-[var(--border)]" style={{ animationDelay: "150ms" }} />
          </div>
        </div>
        <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "225ms" }} />
        <div className="h-48 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "300ms" }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04]">
            <svg className="h-5 w-5 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-[var(--ink)]">Player not found</div>
          <div className="mt-1 text-sm text-[var(--muted)]">This player does not exist.</div>
          <Link
            href="/clubs"
            className="mt-4 rounded-full border border-[var(--border)] bg-white/80 px-4 py-2 text-sm font-medium transition-all duration-200 hover:bg-white hover:shadow-sm"
          >
            Back to clubs
          </Link>
        </div>
      </div>
    );
  }

  const name = profile.display_name || "Unknown player";
  const crest = initials(name);
  const total = record.wins + record.losses + record.ties;
  const isMe = meId === playerId;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-5">
        <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-md">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-xl font-bold">
              {crest}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{name}</h1>
          {profile.handicap_index != null && (
            <div className="mt-1 text-sm text-[var(--muted)]">
              Handicap index: <span className="font-semibold text-[var(--ink)]">{profile.handicap_index}</span>
            </div>
          )}
          {isMe && (
            <Link
              href="/profile"
              className="mt-1 inline-block text-xs font-medium text-[var(--pine)] hover:underline"
            >
              Edit profile
            </Link>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-emerald-50/80 to-white p-4 text-center">
          <div className="text-2xl font-bold text-emerald-700">{record.wins}</div>
          <div className="text-xs font-medium text-emerald-600/70">Wins</div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-red-50/80 to-white p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{record.losses}</div>
          <div className="text-xs font-medium text-red-500/70">Losses</div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-slate-50/80 to-white p-4 text-center">
          <div className="text-2xl font-bold text-slate-500">{record.ties}</div>
          <div className="text-xs font-medium text-slate-400">Ties</div>
        </div>
      </div>

      {/* Clubs */}
      {clubs.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 sm:p-6">
          <div className="mb-3 text-sm font-bold tracking-tight">Clubs</div>
          <div className="flex flex-wrap gap-2">
            {clubs.map((c) => (
              <Link
                key={c.id}
                href={`/clubs/${c.id}`}
                className="inline-flex items-center rounded-full border border-[var(--border)] bg-white/80 px-3 py-1.5 text-sm font-medium text-[var(--ink)] transition-all duration-200 hover:bg-white hover:shadow-sm hover:text-[var(--pine)]"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent matches */}
      {recentMatches.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold tracking-tight">Recent matches</div>
            <div className="text-xs text-[var(--muted)]">{total} completed</div>
          </div>
          <div className="space-y-2">
            {recentMatches.map((m) => (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white/70 p-3 transition-all duration-200 hover:bg-white hover:shadow-sm"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--ink)]">
                    {m.course_name}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    vs {m.opponent_name || "TBD"}
                    {m.round_time && (
                      <> &middot; {new Date(m.round_time).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
                <div className="ml-3 flex-shrink-0">
                  {m.result === "win" && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      W
                    </span>
                  )}
                  {m.result === "loss" && (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-600">
                      L
                    </span>
                  )}
                  {m.result === "tie" && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                      T
                    </span>
                  )}
                  {m.result === "pending" && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-600">
                      In progress
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {!isMe && (
          <Link
            href={`/matches/new`}
            className="rounded-full bg-[var(--pine)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[1px]"
          >
            Challenge
          </Link>
        )}
        <Link
          href="/clubs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] transition-colors duration-200 hover:text-[var(--ink)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </Link>
      </div>
    </div>
  );
}
