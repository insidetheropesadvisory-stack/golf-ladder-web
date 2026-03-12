"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type TournamentInfo = {
  id: string;
  name: string;
  description: string | null;
  period_type: string;
  period_count: number;
  start_date: string;
  end_date: string;
  status: string;
};

export default function TournamentInvitePage() {
  const params = useParams();
  const router = useRouter();
  const inviteId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<TournamentInfo | null>(null);
  const [creator, setCreator] = useState<{ display_name: string | null; avatar_url: string | null } | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setIsAuthed(false);
        setLoading(false);
        return;
      }

      setIsAuthed(true);

      try {
        const res = await fetch(`/api/tournaments/invite/${inviteId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (!res.ok) { setError(json.error ?? "Invalid invite"); setLoading(false); return; }

        setTournament(json.tournament);
        setCreator(json.creator);
        setParticipantCount(json.participantCount ?? 0);
        setAlreadyJoined(json.alreadyJoined ?? false);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load invite");
      }
      setLoading(false);
    }

    if (inviteId) load();
  }, [inviteId]);

  async function join() {
    setJoining(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/tournaments/invite/${inviteId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to join"); setJoining(false); return; }

      router.push(`/tournaments/${json.tournament_id}`);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setJoining(false);
    }
  }

  const creatorName = creator?.display_name || "Someone";
  const unit = tournament?.period_type === "weekly" ? "week" : "month";

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <header className="sticky top-0 z-30 border-b border-[rgba(246,241,231,.14)] bg-[var(--pine)] text-[var(--paper)] shadow-[0_1px_3px_rgba(0,0,0,.12)]">
        <div className="mx-auto flex h-14 w-full max-w-[600px] items-center justify-between px-4">
          <span className="text-[11px] font-medium tracking-[0.3em] opacity-90">RECIPROCITY</span>
          <span className="text-xs opacity-60">Tournament invite</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[500px] px-4 py-8 sm:py-12">
        {loading ? (
          <div className="space-y-4">
            <div className="h-32 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--paper-2)]" />
            <div className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--paper-2)]" style={{ animationDelay: "75ms" }} />
          </div>
        ) : !isAuthed ? (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight">You've been invited!</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Sign in or create an account to join this tournament.</p>
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href={`/login?next=/tournaments/invite/${inviteId}`}
                className="rounded-xl bg-[var(--pine)] px-6 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:shadow-md"
              >
                Sign in to join
              </Link>
            </div>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            <Link href="/tournaments" className="inline-block text-sm font-medium text-[var(--pine)]">Go to tournaments</Link>
          </div>
        ) : alreadyJoined ? (
          <div className="space-y-4 text-center">
            <div className="text-sm font-medium text-[var(--ink)]">You're already in this tournament!</div>
            <Link
              href={`/tournaments/${tournament?.id}`}
              className="inline-block rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Go to tournament
            </Link>
          </div>
        ) : tournament ? (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight">Tournament Invite</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">You've been invited to compete.</p>
            </div>

            <div className="rounded-2xl border-2 border-[var(--pine)]/30 bg-gradient-to-br from-[var(--pine)]/5 to-white p-6 shadow-sm">
              {/* Creator */}
              <div className="flex items-center gap-3 mb-5">
                <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] shadow-sm">
                  {creator?.avatar_url ? (
                    <img src={creator.avatar_url} alt={creatorName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-sm font-bold">{initials(creatorName)}</div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{creatorName}</div>
                  <div className="text-xs text-[var(--muted)]">Organizer</div>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--muted)]">Tournament</span>
                  <span className="text-sm font-semibold text-[var(--ink)]">{tournament.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--muted)]">Duration</span>
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    {tournament.period_count} {unit}{tournament.period_count !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--muted)]">Dates</span>
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    {new Date(tournament.start_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date(tournament.end_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--muted)]">Players</span>
                  <span className="text-sm font-semibold text-[var(--ink)]">{participantCount}</span>
                </div>
              </div>

              {tournament.description && (
                <p className="mt-4 text-sm text-[var(--muted)] border-t border-[var(--border)]/50 pt-3">
                  {tournament.description}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={join}
                disabled={joining}
                className="rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
              >
                {joining ? "Joining..." : "Join tournament"}
              </button>
              <Link
                href="/tournaments"
                className="rounded-xl border border-[var(--border)] bg-white px-6 py-3 text-center text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
              >
                Decline
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
