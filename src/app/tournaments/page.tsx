"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type Tournament = {
  id: string;
  name: string;
  description: string | null;
  creator_id: string;
  period_type: "weekly" | "monthly";
  period_count: number;
  start_date: string;
  end_date: string;
  status: string;
  my_status: string;
  created_at: string;
};

function currentPeriod(t: Tournament): number {
  const now = new Date();
  const start = new Date(t.start_date + "T00:00:00");
  if (t.period_type === "weekly") {
    const diffMs = now.getTime() - start.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(Math.floor(diffDays / 7) + 1, t.period_count));
  } else {
    const months =
      (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth()) +
      1;
    return Math.max(1, Math.min(months, t.period_count));
  }
}

function periodLabel(t: Tournament): string {
  const p = currentPeriod(t);
  const unit = t.period_type === "weekly" ? "Week" : "Month";
  if (t.status === "completed") return "Completed";
  return `${unit} ${p} of ${t.period_count}`;
}

export default function TournamentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch("/api/tournaments", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to load tournaments");
        }
        const json = await res.json();
        if (mounted) {
          setTournaments(json.tournaments ?? []);
          setCounts(json.participantCounts ?? {});
        }
      } catch (e: any) {
        if (mounted) setError(e?.message ?? "Failed to load");
      }
      if (mounted) setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function respond(tournamentId: string, response: "accepted" | "declined") {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "respond", tournament_id: tournamentId, response }),
      });
      if (res.ok) {
        setTournaments((prev) =>
          prev.map((t) =>
            t.id === tournamentId
              ? { ...t, my_status: response }
              : t
          ).filter((t) => !(t.id === tournamentId && response === "declined"))
        );
      }
    } catch {}
  }

  const active = tournaments.filter((t) => t.status === "active" && t.my_status === "accepted");
  const invites = tournaments.filter((t) => t.my_status === "invited");
  const completed = tournaments.filter((t) => t.status === "completed" && t.my_status === "accepted");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tournaments</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Compete with friends over weeks or months, each playing their own rounds.
          </p>
        </div>
        <Link
          href="/tournaments/new"
          className="flex-shrink-0 rounded-xl bg-[var(--pine)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
        >
          Create
        </Link>
      </div>

      {/* Open Tournaments announcement */}
      <div className="context-strip context-strip--tan">
        <strong>Open Tournaments — Summer 2026.</strong> Public tournaments open to all Reciprocity members will be announced at the beginning of summer. Stay tuned.
      </div>

      {/* How it works */}
      <div className="rounded-[6px] border border-[var(--border)] bg-white/60 p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)] mb-3">How it works</div>
        <div className="space-y-2 text-sm text-[var(--ink)]">
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">1</span>
            <span>Create a tournament spanning multiple weeks or months and invite friends.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">2</span>
            <span><span className="font-medium">One score per period.</span> Play a round at any course, submit your score, and it's locked in. Scores must be entered within <span className="font-medium">12 hours</span> or the period counts as N/A.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--pine)]/10 text-[10px] font-bold text-[var(--pine)]">3</span>
            <span>Scores are normalized using <span className="font-medium">course rating &amp; slope</span> so every course is fair. Lowest differential each period wins. Lowest average wins overall.</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-black/[0.03]" />
          <div className="h-24 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div>{error}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
          >
            Reload
          </button>
        </div>
      ) : (
        <>
          {/* Invitations */}
          {invites.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Invitations</h2>
              {invites.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl border-2 border-amber-200/60 bg-amber-50/30 p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-[var(--ink)]">{t.name}</div>
                      <div className="mt-0.5 text-xs text-[var(--muted)]">
                        {t.period_count} {t.period_type === "weekly" ? "weeks" : "months"} &middot;{" "}
                        {counts[t.id] ?? 0} player{(counts[t.id] ?? 0) !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => respond(t.id, "accepted")}
                      className="rounded-xl bg-[var(--pine)] px-4 py-2 text-sm font-semibold text-white transition hover:shadow-md"
                    >
                      Join
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(t.id, "declined")}
                      className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Active tournaments */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Active</h2>
            {active.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-6 text-center">
                <div className="text-sm font-medium text-[var(--ink)]">No tournaments yet</div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Join one and compete across multiple rounds — play your best round each period at any course, lowest differential wins.
                </p>
                <Link href="/tournaments" className="mt-3 inline-flex text-xs font-semibold text-[var(--pine)] underline">Browse Tournaments</Link>
              </div>
            ) : (
              active.map((t) => (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  className="group block rounded-2xl border border-[var(--border)] bg-white/60 p-4 transition hover:border-[var(--pine)]/20 hover:shadow-sm sm:p-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-[var(--ink)] group-hover:text-[var(--pine)] transition-colors">
                        {t.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                        <span>{periodLabel(t)}</span>
                        <span className="text-[var(--border)]">&middot;</span>
                        <span>{counts[t.id] ?? 0} player{(counts[t.id] ?? 0) !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 border border-emerald-200/60">
                        {periodLabel(t)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </section>

          {/* Completed */}
          {completed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Completed</h2>
              {completed.map((t) => (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  className="group block rounded-2xl border border-[var(--border)] bg-white/60 p-4 transition hover:shadow-sm sm:p-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-[var(--ink)]">{t.name}</div>
                      <div className="mt-0.5 text-xs text-[var(--muted)]">
                        {t.period_count} {t.period_type === "weekly" ? "weeks" : "months"} &middot;{" "}
                        {counts[t.id] ?? 0} players
                      </div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 border border-slate-200/60">
                      Final
                    </span>
                  </div>
                </Link>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
