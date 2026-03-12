"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";
import BadgeMarker from "@/app/components/BadgeMarker";
import { type BadgeDef, TIER_ORDER } from "@/lib/badges/defs";

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

type EarnedBadge = BadgeDef & { earned: boolean; unlocked_at: string | null };

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

/** Section flag + gold rule */
function SectionFlag({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="section-flag section-flag--green">{label}</div>
      <div className="flex-1 h-[2px] bg-[var(--gold)]/30" />
    </div>
  );
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
  const [topBadges, setTopBadges] = useState<EarnedBadge[]>([]);

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

        const headers: Record<string, string> = session.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

        // Fetch stats and badges in parallel
        const [statsRes, badgesRes] = await Promise.all([
          fetch(`/api/players/${playerId}/stats`, { headers }),
          fetch(`/api/badges?userId=${playerId}`, { headers }),
        ]);

        if (!statsRes.ok) {
          const json = await statsRes.json().catch(() => ({}));
          setError(json.error ?? "Failed to load player");
          setLoading(false);
          return;
        }

        const data = await statsRes.json();
        setProfile(data.profile);
        setClubs(data.clubs ?? []);
        setH2h(data.h2h);
        setMatches(data.matches ?? []);

        // Badges — show top 5 earned, sorted by tier
        if (badgesRes.ok) {
          const bJson = await badgesRes.json();
          const earned = ((bJson.badges ?? []) as EarnedBadge[]).filter(
            (b) => b.earned
          );
          const sorted = [...earned].sort(
            (a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier]
          );
          setTopBadges(sorted.slice(0, 5));
        }
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
      <div className="space-y-6">
        <div className="rounded-[6px] overflow-hidden">
          <div className="bg-[var(--pine)] px-6 py-10">
            <div className="flex flex-col items-center gap-4">
              <div className="h-[88px] w-[88px] animate-pulse rounded-full bg-white/10" />
              <div className="h-6 w-40 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
            </div>
          </div>
        </div>
        <div className="h-20 animate-pulse rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)]" style={{ animationDelay: "75ms" }} />
        <div className="h-48 animate-pulse rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)]" style={{ animationDelay: "150ms" }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-8 text-center">
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
    <div className="space-y-6">
      {/* ═══ Back button — styled nav ═══ */}
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* ═══ 1. HEADER — dark green band ═══ */}
      <div className="rounded-[6px] overflow-hidden shadow-sm">
        <div className="bg-[var(--pine)] px-6 pb-8 pt-10 border-b-2 border-[var(--gold)]">
          <div className="flex flex-col items-center">
            {/* Avatar with gold ring */}
            <div
              className="h-[88px] w-[88px] overflow-hidden rounded-full shadow-lg"
              style={{ border: "3px solid var(--gold)" }}
            >
              {profile.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt={name}
                  width={88}
                  height={88}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[var(--gold-light)] text-[var(--pine)]">
                  <span className="text-2xl font-semibold">{initials(name)}</span>
                </div>
              )}
            </div>

            {/* Name — Playfair, cream, large */}
            <h1
              className="mt-4 text-[28px] font-semibold tracking-tight text-[var(--paper)]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {name}
            </h1>

            {/* HCP pill + club tags */}
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
              {profile.handicap_index != null && (
                <span
                  className="inline-flex items-center rounded-full border border-[var(--gold)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--gold)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  HCP {profile.handicap_index}
                </span>
              )}
              {clubs.map((c) => (
                <Link
                  key={c.id}
                  href={`/clubs/${c.id}`}
                  className="rounded-full border border-[var(--paper)]/20 px-2.5 py-0.5 text-[11px] font-medium text-[var(--paper)]/70 transition hover:text-[var(--paper)] hover:border-[var(--paper)]/40"
                >
                  {c.name}
                </Link>
              ))}
            </div>

            {/* Challenge button — gold fill */}
            <Link
              href={`/matches/new?opponent=${playerId}`}
              className="btn-gold mt-5 inline-flex items-center gap-1.5 px-6 py-2.5 text-[12px] font-bold uppercase tracking-[0.08em] shadow-sm hover:shadow-md hover:-translate-y-[1px] transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7M4 22h16M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
              Challenge
            </Link>
          </div>
        </div>
      </div>

      {/* ═══ 2. MARKERS — top 5 earned badges ═══ */}
      {topBadges.length > 0 && (
        <section className="space-y-4">
          <SectionFlag label="Markers" />
          <div className="flex items-center justify-center gap-3">
            {topBadges.map((b) => (
              <BadgeMarker key={b.slug} badge={b} earned size="medium" />
            ))}
          </div>
        </section>
      )}

      {/* ═══ 3. HEAD TO HEAD ═══ */}
      <section className="space-y-4">
        <SectionFlag label="Head to head" />

        {h2h && h2h.total > 0 ? (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] shadow-sm overflow-hidden">
            <div className="p-5">
              {/* Big score line */}
              <div className="flex items-center justify-center gap-4">
                <div className="text-center">
                  <div
                    className="text-[36px] tabular-nums text-green-700"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {h2h.wins}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--muted)]">
                    Your wins
                  </div>
                </div>
                <div
                  className="text-[28px] text-[var(--gold)]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  &mdash;
                </div>
                <div className="text-center">
                  <div
                    className="text-[36px] tabular-nums text-red-600"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {h2h.losses}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--muted)]">
                    Their wins
                  </div>
                </div>
              </div>

              {h2h.ties > 0 && (
                <div className="mt-1 text-center text-[11px] text-[var(--muted)]">
                  {h2h.ties} tie{h2h.ties !== 1 ? "s" : ""}
                </div>
              )}

              {/* Win rate bar */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--muted)]">
                  <span>
                    {h2h.total} match{h2h.total !== 1 ? "es" : ""} played
                  </span>
                  {winPct != null && <span>{winPct}% win rate</span>}
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-black/[0.04]">
                  {h2h.wins > 0 && (
                    <div
                      className="bg-green-500 transition-all"
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
          </div>
        ) : (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-6 text-center">
            <div
              className="text-[36px] text-[var(--muted)]/40"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              0 &mdash; 0
            </div>
            <p className="mt-2 text-[12px] text-[var(--muted)]">
              No matches played yet. Time to change that.
            </p>
            <Link
              href={`/matches/new?opponent=${playerId}`}
              className="btn-gold mt-3 inline-flex text-[11px] px-4 py-2"
            >
              Send a Challenge
            </Link>
          </div>
        )}
      </section>

      {/* ═══ 4. MATCH HISTORY ═══ */}
      {matches.length > 0 && (
        <section className="space-y-4">
          <SectionFlag label={`Match history (${matches.length})`} />

          <div className="space-y-2">
            {matches.map((m) => {
              const resultLabel =
                m.result === "win" ? "W" : m.result === "loss" ? "L" : "T";
              const resultPillColor =
                m.result === "win"
                  ? "bg-green-600 text-white"
                  : m.result === "loss"
                  ? "bg-red-500 text-white"
                  : "bg-gray-300 text-gray-700";

              const isMatchPlay = m.format === "match_play";
              const date = fmtDate(m.round_time ?? m.created_at);

              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group flex items-center gap-3 rounded-[6px] border border-[var(--border)] border-l-[3px] border-l-[var(--pine)] bg-[var(--paper-2)] px-4 py-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
                >
                  {/* Result pill */}
                  <div
                    className={cx(
                      "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                      resultPillColor
                    )}
                  >
                    {resultLabel}
                  </div>

                  {/* Match info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[13px] font-bold text-[var(--ink)]"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {m.course_name}
                      </span>
                      {m.is_ladder_match && (
                        <span className="rounded-full bg-[var(--gold-light)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--gold)]">
                          Ladder
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted)]">
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
                        <span className={m.result === "win" ? "text-green-700" : "text-[var(--ink)]"}>
                          {m.myHolesWon}
                        </span>
                        <span className="text-[var(--muted)] mx-0.5">-</span>
                        <span className={m.result === "loss" ? "text-red-600" : "text-[var(--ink)]"}>
                          {m.oppHolesWon}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm font-bold tabular-nums">
                        <span className={m.result === "win" ? "text-green-700" : "text-[var(--ink)]"}>
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
        </section>
      )}
    </div>
  );
}
