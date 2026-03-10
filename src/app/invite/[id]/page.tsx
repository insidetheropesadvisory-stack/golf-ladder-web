"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type MatchInfo = {
  id: string;
  creator_id: string;
  course_name: string;
  format: string;
  use_handicap: boolean;
  round_time: string | null;
  guest_fee: number | null;
  is_ladder_match: boolean;
  status: string;
  terms_status: string | null;
  opponent_id: string | null;
};

type CreatorProfile = {
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const matchId =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
      ? params.id[0]
      : "";

  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [clubId, setClubId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      // Check auth
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        setIsAuthed(true);

        // Fetch match
        const { data: matchData, error: matchErr } = await supabase
          .from("matches")
          .select(
            "id, creator_id, course_name, format, use_handicap, round_time, guest_fee, is_ladder_match, status, terms_status, opponent_id"
          )
          .eq("id", matchId)
          .single();

        if (matchErr || !matchData) {
          setError("Match not found or link is invalid.");
          setLoading(false);
          return;
        }

        const m = matchData as MatchInfo;
        setMatch(m);

        // Look up club for linking
        if (m.course_name) {
          supabase
            .from("clubs")
            .select("id")
            .ilike("name", m.course_name)
            .maybeSingle()
            .then(({ data: clubData }) => {
              if (clubData?.id) setClubId(clubData.id);
            });
        }

        if (m.creator_id === session.user.id) {
          setIsCreator(true);
        }

        if (
          m.status === "active" ||
          m.terms_status === "accepted" ||
          (m.opponent_id && m.opponent_id !== session.user.id)
        ) {
          setAlreadyClaimed(true);
        }

        // Fetch creator profile
        const { data: profData } = await supabase
          .from("profiles")
          .select("display_name, avatar_url, handicap_index")
          .eq("id", m.creator_id)
          .maybeSingle();

        if (profData) setCreator(profData as CreatorProfile);
      }

      setLoading(false);
    }

    if (matchId) load();
  }, [matchId]);

  async function claimMatch() {
    setClaiming(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/claim-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ matchId, action: "accept" }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to accept invite");
        setClaiming(false);
        return;
      }

      router.push(`/matches/${matchId}`);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setClaiming(false);
    }
  }

  const fmtFormat =
    match?.format === "match_play" ? "Match Play" : "Stroke Play";
  const creatorName = creator?.display_name || "Someone";

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[rgba(246,241,231,.14)] bg-[var(--pine)] text-[var(--paper)] shadow-[0_1px_3px_rgba(0,0,0,.12)]">
        <div className="mx-auto flex h-14 w-full max-w-[600px] items-center justify-between px-4">
          <span className="text-[11px] font-medium tracking-[0.3em] opacity-90">
            RECIPROCITY
          </span>
          <span className="text-xs opacity-60">Match invite</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[500px] px-4 py-8 sm:py-12">
        {loading ? (
          <div className="space-y-4">
            <div className="h-32 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--paper-2)]" />
            <div
              className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--paper-2)]"
              style={{ animationDelay: "75ms" }}
            />
          </div>
        ) : !isAuthed ? (
          /* Not logged in — prompt to sign up / log in */
          <div className="space-y-6">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--pine)]/10">
                <svg
                  className="h-8 w-8 text-[var(--pine)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                You've been challenged!
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Sign in or create an account to view and accept this match
                invitation.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Link
                href={`/login?next=/invite/${matchId}`}
                className="rounded-xl bg-[var(--pine)] px-6 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
              >
                Sign in to accept
              </Link>
              <Link
                href={`/login?next=/invite/${matchId}`}
                className="rounded-xl border border-[var(--border)] bg-white px-6 py-3 text-center text-sm font-semibold text-[var(--ink)] transition hover:shadow-sm"
              >
                Create an account
              </Link>
            </div>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
            <Link
              href="/"
              className="inline-block text-sm font-medium text-[var(--pine)]"
            >
              Go to home
            </Link>
          </div>
        ) : isCreator ? (
          /* Creator viewing their own invite */
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight">
                This is your invite
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Share the link below with your opponent.
              </p>
            </div>
            <InviteLinkBox matchId={matchId} />
            <Link
              href={`/matches/${matchId}`}
              className="block rounded-xl border border-[var(--border)] bg-white px-5 py-3 text-center text-sm font-semibold text-[var(--ink)] transition hover:shadow-sm"
            >
              View match details
            </Link>
          </div>
        ) : alreadyClaimed ? (
          <div className="space-y-4 text-center">
            <div className="text-sm font-medium text-[var(--ink)]">
              This invite has already been accepted.
            </div>
            <Link
              href={`/matches/${matchId}`}
              className="inline-block rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Go to match
            </Link>
          </div>
        ) : (
          /* Show the invite to accept */
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight">
                Match challenge
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                You've been invited to play a round.
              </p>
            </div>

            {/* Challenge card */}
            <div className="rounded-2xl border-2 border-[var(--pine)]/30 bg-gradient-to-br from-[var(--pine)]/5 to-white p-6 shadow-sm">
              {/* Creator info */}
              <div className="flex items-center gap-3 mb-5">
                <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm">
                  {creator?.avatar_url ? (
                    <img
                      src={creator.avatar_url}
                      alt={creatorName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-sm font-bold">
                      {initials(creatorName)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">
                    {creatorName}
                  </div>
                  {creator?.handicap_index != null && (
                    <div className="text-xs text-[var(--muted)]">
                      HCP {creator.handicap_index}
                    </div>
                  )}
                </div>
                <div className="ml-auto text-xs font-semibold uppercase tracking-wide text-[var(--pine)]">
                  Challenger
                </div>
              </div>

              {/* Match details */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--muted)]">
                    Course
                  </span>
                  {clubId ? (
                    <Link
                      href={`/clubs/${clubId}`}
                      className="text-sm font-semibold text-[var(--pine)] underline decoration-[var(--pine)]/30 transition hover:decoration-[var(--pine)]"
                    >
                      {match?.course_name}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      {match?.course_name}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--muted)]">
                    Format
                  </span>
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    {fmtFormat}
                    {match?.use_handicap ? " (Net)" : ""}
                  </span>
                </div>
                {match?.round_time && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--muted)]">
                      Tee time
                    </span>
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      {new Date(match.round_time).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
                {match?.guest_fee != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--muted)]">
                      Guest fee
                    </span>
                    <span className="text-sm font-semibold text-emerald-700">
                      ${match.guest_fee}
                    </span>
                  </div>
                )}
                {match?.is_ladder_match && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--muted)]">
                      Type
                    </span>
                    <span className="rounded-full bg-amber-100/60 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Ladder match
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={claimMatch}
                disabled={claiming}
                className="rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
              >
                {claiming ? "Accepting..." : "Accept challenge"}
              </button>
              <Link
                href="/"
                className="rounded-xl border border-[var(--border)] bg-white px-6 py-3 text-center text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)] hover:shadow-sm"
              >
                Decline
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteLinkBox({ matchId }: { matchId: string }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/invite/${matchId}`
      : "";

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function shareLink() {
    try {
      await navigator.share({
        title: "Golf match challenge",
        text: "You've been challenged to a round on Reciprocity!",
        url: inviteUrl,
      });
      setShared(true);
    } catch {}
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-5 shadow-sm space-y-4">
      <div className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
        Invite link
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--paper-2)] px-3 py-2.5">
        <code className="flex-1 truncate text-xs text-[var(--ink)]">
          {inviteUrl}
        </code>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="flex-1 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:shadow-sm"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={shareLink}
            className="flex-1 rounded-xl bg-[var(--pine)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
          >
            {shared ? "Shared!" : "Share"}
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Send this link to your opponent via text, WhatsApp, or any messaging
        app. They'll sign up and the match will be waiting for them.
      </p>
    </div>
  );
}
