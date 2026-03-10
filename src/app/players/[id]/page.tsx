"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
  email: string | null;
};

type Club = { id: string; name: string };

type H2H = { wins: number; losses: number; ties: number; total: number };

type MatchSummary = {
  id: string;
  course_name: string;
  format: string;
  use_handicap: boolean;
  is_ladder_match: boolean;
  created_at: string;
  round_time: string | null;
  result: "win" | "loss" | "tie";
  myScore: number | null;
  oppScore: number | null;
  myHolesWon?: number;
  oppHolesWon?: number;
};

function fmtFormat(f: string) {
  if (f === "match_play") return "Match Play";
  if (f === "stroke_play") return "Stroke Play";
  return f.replaceAll("_", " ");
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PlayerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const playerId =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
      ? params.id[0]
      : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [h2h, setH2h] = useState<H2H | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [isMe, setIsMe] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) {
          router.replace("/login");
          return;
        }

        if (session.user.id === playerId) {
          setIsMe(true);
          router.replace("/profile");
          return;
        }

        const res = await fetch(`/api/players/${playerId}/stats`, {
          headers: session.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? "Failed to load player");
          setLoading(false);
          return;
        }

        const data = await res.json();
        setProfile(data.profile);
        setClubs(data.clubs ?? []);
        setH2h(data.h2h);
        setMatches(data.matches ?? []);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
      }
      setLoading(false);
    }

    if (playerId) load();
  }, [playerId, router]);

  if (isMe) return null;

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" />
        <div className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "75ms" }} />
        <div className="h-48 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "150ms" }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">
            {error ?? "Player not found"}
          </div>
        </div>
      </div>
    );
  }

  const name = profile.display_name || "Unknown";
  const winPct =
    h2h && h2h.total > 0 ? Math.round((h2h.wins / h2h.total) * 100) : null;

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Player header */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-[var(--pine)] text-white shadow-sm">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={name}
                width={64}
                height={64}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-lg font-bold">
                {initials(name)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight truncate">{name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              {profile.handicap_index != null && (
                <span className="rounded-full bg-black/[0.04] px-2 py-0.5 font-medium">
                  HCP {profile.handicap_index}
                </span>
              )}
              {clubs.map((c) => (
                <Link
                  key={c.id}
                  href={`/clubs/${c.id}`}
                  className="rounded-full bg-[var(--pine)]/10 px-2 py-0.5 font-medium text-[var(--pine)] transition hover:bg-[var(--pine)]/20"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
          <Link
            href={`/matches/new?opponent=${playerId}`}
            className="flex-shrink-0 rounded-xl bg-[var(--pine)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
          >
            Challenge
          </Link>
        </div>
      </div>

      {/* Head-to-head record */}
      {h2h && h2h.total > 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-5 shadow-sm">
          <div className="mb-4 text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
            Head to Head
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200/50 bg-emerald-50/50 p-3 text-center">
              <div className="text-2xl font-bold text-emerald-700">{h2h.wins}</div>
              <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-600">
                Your wins
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-black/[0.02] p-3 text-center">
              <div className="text-2xl font-bold text-[var(--muted)]">{h2h.ties}</div>
              <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Ties
              </div>
            </div>
            <div className="rounded-xl border border-red-200/50 bg-red-50/50 p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{h2h.losses}</div>
              <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-red-500">
                Their wins
              </div>
            </div>
          </div>

          {/* Win rate bar */}
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
              <span>
                {h2h.total} match{h2h.total !== 1 ? "es" : ""} played
              </span>
              {winPct != null && <span>{winPct}% win rate</span>}
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-black/[0.04]">
              {h2h.wins > 0 && (
                <div
                  className="bg-emerald-500 transition-all"
                  style={{ width: `${(h2h.wins / h2h.total) * 100}%` }}
                />
              )}
              {h2h.ties > 0 && (
                <div
                  className="bg-gray-300 transition-all"
                  style={{ width: `${(h2h.ties / h2h.total) * 100}%` }}
                />
              )}
              {h2h.losses > 0 && (
                <div
                  className="bg-red-400 transition-all"
                  style={{ width: `${(h2h.losses / h2h.total) * 100}%` }}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-6 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">
            No matches played yet
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Challenge {name} to start your head-to-head record.
          </p>
        </div>
      )}

      {/* Match history */}
      {matches.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
            Match History ({matches.length})
          </div>

          <div className="space-y-2">
            {matches.map((m) => {
              const resultColor =
                m.result === "win"
                  ? "border-emerald-200/60 bg-emerald-50/30"
                  : m.result === "loss"
                  ? "border-red-200/60 bg-red-50/30"
                  : "border-[var(--border)] bg-white/60";

              const resultLabel =
                m.result === "win" ? "W" : m.result === "loss" ? "L" : "T";
              const resultBadgeColor =
                m.result === "win"
                  ? "bg-emerald-500 text-white"
                  : m.result === "loss"
                  ? "bg-red-500 text-white"
                  : "bg-gray-300 text-gray-700";

              const isMatchPlay = m.format === "match_play";
              const date = fmtDate(m.round_time ?? m.created_at);

              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className={cx(
                    "group flex items-center gap-3 rounded-xl border px-4 py-3 transition hover:shadow-sm",
                    resultColor
                  )}
                >
                  {/* Result badge */}
                  <div
                    className={cx(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                      resultBadgeColor
                    )}
                  >
                    {resultLabel}
                  </div>

                  {/* Match info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--ink)]">
                        {m.course_name}
                      </span>
                      {m.is_ladder_match && (
                        <span className="rounded-full bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Ladder
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span>{fmtFormat(m.format)}</span>
                      {m.use_handicap && (
                        <>
                          <span className="text-[var(--border)]">&middot;</span>
                          <span>Net</span>
                        </>
                      )}
                      {date && (
                        <>
                          <span className="text-[var(--border)]">&middot;</span>
                          <span>{date}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Score */}
                  <div className="flex-shrink-0 text-right">
                    {isMatchPlay ? (
                      <div className="text-sm font-bold tabular-nums">
                        <span className={m.result === "win" ? "text-emerald-700" : "text-[var(--ink)]"}>
                          {m.myHolesWon}
                        </span>
                        <span className="text-[var(--muted)] mx-0.5">-</span>
                        <span className={m.result === "loss" ? "text-red-600" : "text-[var(--ink)]"}>
                          {m.oppHolesWon}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm font-bold tabular-nums">
                        <span className={m.result === "win" ? "text-emerald-700" : "text-[var(--ink)]"}>
                          {m.myScore ?? "—"}
                        </span>
                        <span className="text-[var(--muted)] mx-0.5">-</span>
                        <span className={m.result === "loss" ? "text-red-600" : "text-[var(--ink)]"}>
                          {m.oppScore ?? "—"}
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] text-[var(--muted)]">
                      {isMatchPlay ? "holes won" : "strokes"}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
