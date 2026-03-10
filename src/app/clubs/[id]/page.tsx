"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type Club = { id: string; name: string; city: string | null; state: string | null; logo_url: string | null };
type Member = { id: string; display_name: string | null; avatar_url: string | null; handicap_index: number | null; guest_fee: number | null };
type LeaderboardEntry = Member & { wins: number; losses: number; played: number };
type UpcomingMatch = { id: string; creator_name: string; opponent_name: string; round_time: string | null; format: string; is_ladder_match: boolean; status: string };

export default function ClubDetailPage() {
  const params = useParams();
  const clubId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [loading, setLoading] = useState(true);
  const [club, setClub] = useState<Club | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingMatch[]>([]);
  const [tab, setTab] = useState<"members" | "leaderboard" | "upcoming">("members");

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch(`/api/clubs/${clubId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = await res.json();

        setClub(json.club);
        setMembers(json.members ?? []);
        setLeaderboard(json.leaderboard ?? []);
        setUpcoming(json.upcoming ?? []);
      } catch {}
      setLoading(false);
    }

    if (clubId) load();
  }, [clubId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-20 rounded-2xl bg-black/[0.03]" />
        <div className="h-10 rounded-xl bg-black/[0.03]" />
        <div className="h-40 rounded-2xl bg-black/[0.03]" />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm font-medium text-[var(--ink)]">Club not found</div>
        <Link href="/clubs" className="mt-2 inline-block text-sm text-[var(--pine)] underline">Back to memberships</Link>
      </div>
    );
  }

  const loc = [club.city, club.state].filter(Boolean).join(", ");

  const tabs: { key: typeof tab; label: string; count: number }[] = [
    { key: "members", label: "Members", count: members.length },
    { key: "leaderboard", label: "Leaderboard", count: leaderboard.length },
    { key: "upcoming", label: "Upcoming", count: upcoming.length },
  ];

  return (
    <div className="space-y-5">
      {/* Club header */}
      <div className="flex items-center gap-4">
        <Link href="/clubs" className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-white/60 text-[var(--muted)] transition hover:bg-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-[var(--pine)] text-white shadow-sm">
          {club.logo_url ? (
            <img src={club.logo_url} alt={club.name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-lg font-semibold">{initials(club.name)}</div>
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{club.name}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
            {loc && <span>{loc}</span>}
            {loc && <span className="text-[var(--border)]">&middot;</span>}
            <span>{members.length} member{members.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cx(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              tab === t.key
                ? "bg-[var(--pine)] text-white"
                : "bg-black/[0.04] text-[var(--muted)] hover:bg-black/[0.07]"
            )}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Members tab */}
      {tab === "members" && (
        <div className="space-y-2">
          {members.map((m, i) => (
            <Link
              key={m.id}
              href={`/players/${m.id}`}
              className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--pine)] text-white text-xs font-semibold">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(m.display_name ?? undefined)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium group-hover:text-[var(--pine)] transition-colors">{m.display_name || "Unknown"}</div>
                <div className="text-xs text-[var(--muted)]">
                  {m.handicap_index != null ? `HCP ${m.handicap_index}` : "No handicap"}
                  {m.guest_fee != null && <span className="ml-2">Guest fee: ${m.guest_fee}</span>}
                </div>
              </div>
              <div className="text-xs font-medium text-[var(--muted)] tabular-nums">
                #{i + 1}
              </div>
            </Link>
          ))}
          {members.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">No members yet</div>
          )}
        </div>
      )}

      {/* Leaderboard tab */}
      {tab === "leaderboard" && (
        <div className="space-y-2">
          {leaderboard.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
              <div className={cx(
                "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold",
                i === 0 ? "bg-amber-100 text-amber-800" : i === 1 ? "bg-gray-100 text-gray-600" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-black/[0.03] text-[var(--muted)]"
              )}>
                {i + 1}
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--pine)] text-white text-xs font-semibold">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(m.display_name ?? undefined)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.display_name || "Unknown"}</div>
                <div className="text-xs text-[var(--muted)]">{m.played} match{m.played !== 1 ? "es" : ""} at this club</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">
                  <span className="text-green-700">{m.wins}W</span>
                  <span className="text-[var(--muted)] mx-0.5">-</span>
                  <span className="text-red-600">{m.losses}L</span>
                </div>
                {m.played > 0 && (
                  <div className="text-[10px] text-[var(--muted)]">{Math.round((m.wins / m.played) * 100)}% win</div>
                )}
              </div>
            </div>
          ))}
          {leaderboard.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              No completed matches at this club yet
            </div>
          )}
        </div>
      )}

      {/* Upcoming tab */}
      {tab === "upcoming" && (
        <div className="space-y-2">
          {upcoming.map((m) => (
            <Link
              key={m.id}
              href={`/matches/${m.id}`}
              className="group flex items-center justify-between rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {m.creator_name} vs {m.opponent_name}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                  <span>{m.format === "match_play" ? "Match Play" : "Stroke Play"}</span>
                  {m.is_ladder_match && (
                    <span className="rounded-full bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Ladder</span>
                  )}
                  <span className="capitalize">{m.status}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {m.round_time ? (
                  <div className="text-xs font-medium text-[var(--ink)]">
                    {new Date(m.round_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--muted)]">No date</div>
                )}
              </div>
            </Link>
          ))}
          {upcoming.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              No upcoming matches at this club
            </div>
          )}
        </div>
      )}
    </div>
  );
}
