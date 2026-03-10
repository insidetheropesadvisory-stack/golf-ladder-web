"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cx } from "@/lib/utils";

/**
 * Client UI for Home.
 * Receives clubs/matches/profile from the server wrapper in src/app/page.tsx
 */

export type Club = {
  id: string;
  name: string;
  verified?: boolean;
};

export type MatchStatus = "proposal" | "active" | "completed";

export type Match = {
  id: string;
  status: MatchStatus;
  clubId: string;

  opponentName: string;

  formatLabel?: string; // e.g. "Stroke Play • Gross"
  stakesLabel?: string; // e.g. "$20 Nassau"
  whenLabel?: string; // e.g. "Sun 10:10 AM"
  scoringOpen?: boolean;

  updatedAt?: string; // ISO date string
};

export type Profile = {
  displayName?: string;
  handicap?: number | null;
  hasName?: boolean;
};

function formatTimeAgo(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatusPill({ status }: { status: MatchStatus }) {
  const label =
    status === "proposal" ? "Proposed" : status === "active" ? "Active" : "Completed";

  const cls =
    status === "proposal"
      ? "bg-[rgba(17,19,18,.06)] text-[rgba(17,19,18,.75)]"
      : status === "active"
      ? "bg-[rgba(11,59,46,.12)] text-[var(--pine)]"
      : "bg-[rgba(17,19,18,.06)] text-[rgba(17,19,18,.65)]";

  return (
    <span className={cx("rounded-full px-3 py-1 text-xs font-medium", cls)}>{label}</span>
  );
}

function MatchCard({
  match,
  clubName,
  showClubName,
}: {
  match: Match;
  clubName?: string;
  showClubName: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-4 shadow-[0_10px_28px_rgba(17,19,18,.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-base font-semibold">{match.opponentName}</div>

            {showClubName && clubName ? (
              <span className="rounded-full border border-[var(--border)] bg-white/40 px-2 py-0.5 text-[11px] text-[var(--muted)]">
                {clubName}
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
            {match.formatLabel ? <span>{match.formatLabel}</span> : null}
            {match.stakesLabel ? <span>• {match.stakesLabel}</span> : null}
            {match.whenLabel ? <span>• {match.whenLabel}</span> : null}
            {match.scoringOpen ? <span>• Scoring open</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusPill status={match.status} />
          <div className="text-xs text-[var(--muted)]">{formatTimeAgo(match.updatedAt)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/matches/${match.id}`}
          className="rounded-full bg-[var(--pine)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:-translate-y-[1px]"
        >
          View
        </Link>

        {/* UI placeholders — wire these up to your actions later */}
        {match.status === "proposal" ? (
          <>
            <button className="rounded-full border border-[var(--border)] bg-white/50 px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:bg-white/70">
              Accept
            </button>
            <button className="rounded-full border border-[var(--border)] bg-white/0 px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-white/40">
              Decline
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function HomeClient({
  clubs,
  matches,
  profile,
}: {
  clubs: Club[];
  matches: Match[];
  profile: Profile;
}) {
  const [tab, setTab] = useState<MatchStatus>("proposal");
  const [clubFilter, setClubFilter] = useState<string>("all");

  const clubsById = useMemo(() => new Map(clubs.map((c) => [c.id, c] as const)), [clubs]);

  const filteredMatches = useMemo(() => {
    return clubFilter === "all" ? matches : matches.filter((m) => m.clubId === clubFilter);
  }, [matches, clubFilter]);

  const counts = useMemo(() => {
    const base = clubFilter === "all" ? matches : matches.filter((m) => m.clubId === clubFilter);
    return {
      proposal: base.filter((m) => m.status === "proposal").length,
      active: base.filter((m) => m.status === "active").length,
      completed: base.filter((m) => m.status === "completed").length,
    };
  }, [matches, clubFilter]);

  const list = useMemo(() => {
    const tabbed = filteredMatches.filter((m) => m.status === tab);
    return [...tabbed].sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });
  }, [filteredMatches, tab]);

  const showClubName = clubFilter === "all" && clubs.length > 1;

  const readyChecklist = useMemo(() => {
    const items = [
      { label: "Name set", done: !!profile.hasName },
      { label: "Handicap (optional)", done: typeof profile.handicap === "number" },
      { label: "Join a club", done: clubs.length > 0 },
    ];
    return { items, doneCount: items.filter((i) => i.done).length };
  }, [profile.hasName, profile.handicap, clubs.length]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
      {/* LEFT: Matches Inbox */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] tracking-[0.28em] text-[var(--muted)]">
              RECIPROCITY
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Matches</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Propose. Accept. Play. Post.</p>
          </div>

          <Link
            href="/matches/new"
            className="rounded-full bg-[var(--pine)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:-translate-y-[1px]"
          >
            New match
          </Link>
        </div>

        {/* Controls */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Club filter (multi-club membership supported) */}
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-[var(--muted)]">Club</div>
            <div className="relative">
              <select
                value={clubFilter}
                onChange={(e) => setClubFilter(e.target.value)}
                className="appearance-none rounded-xl border border-[var(--border)] bg-[var(--paper-2)] px-3 py-2 pr-9 text-sm shadow-[0_10px_24px_rgba(17,19,18,.06)]"
              >
                <option value="all">All clubs</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.verified ? " (verified)" : ""}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
                ▾
              </div>
            </div>
          </div>

          {/* Segmented tabs */}
          <div className="flex w-full items-center rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-1 shadow-[0_10px_24px_rgba(17,19,18,.06)] sm:w-auto">
            {(["proposal", "active", "completed"] as const).map((k) => {
              const label =
                k === "proposal" ? "Proposed" : k === "active" ? "Active" : "Completed";
              const active = tab === k;
              const count = counts[k];

              return (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cx(
                    "flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition",
                    active
                      ? "bg-white/70 text-[var(--pine)] shadow-[0_10px_24px_rgba(17,19,18,.08)]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  )}
                >
                  <span>{label}</span>
                  <span
                    className={cx(
                      "rounded-full px-2 py-0.5 text-xs",
                      active
                        ? "bg-[rgba(11,59,46,.10)] text-[var(--pine)]"
                        : "bg-[rgba(17,19,18,.06)] text-[var(--muted)]"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* List */}
        <div className="mt-5 space-y-3">
          {list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--paper-2)] p-8 text-center">
              <div className="text-sm font-medium">Nothing here yet.</div>
              <div className="mt-2 text-sm text-[var(--muted)]">
                Create a match or switch clubs to see activity.
              </div>
              <div className="mt-4">
                <Link
                  href="/matches/new"
                  className="inline-flex rounded-full bg-[var(--pine)] px-4 py-2 text-sm font-medium text-[var(--paper)]"
                >
                  New match
                </Link>
              </div>
            </div>
          ) : (
            list.slice(0, 5).map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                clubName={clubsById.get(m.clubId)?.name}
                showClubName={showClubName}
              />
            ))
          )}

          {/* Keep Home airy */}
          {list.length > 5 ? (
            <div className="pt-2">
              <Link
                href={`/matches?tab=${tab}${clubFilter !== "all" ? `&club=${clubFilter}` : ""}`}
                className="text-sm font-medium text-[var(--pine)] hover:underline"
              >
                View all {tab === "proposal" ? "proposals" : tab}
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      {/* RIGHT: Rail */}
      <aside className="space-y-4">
        {/* Ready to play */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 shadow-[0_10px_28px_rgba(17,19,18,.06)]">
          <div className="text-xs tracking-[0.22em] text-[var(--muted)]">ACCOUNT</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold">Ready to play</div>
            <div className="rounded-full bg-[rgba(11,59,46,.10)] px-3 py-1 text-xs font-medium text-[var(--pine)]">
              {readyChecklist.doneCount}/{readyChecklist.items.length}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {readyChecklist.items.map((it) => (
              <div key={it.label} className="flex items-center justify-between">
                <div className="text-sm text-[var(--ink)]">{it.label}</div>
                <div
                  className={cx(
                    "text-xs font-medium",
                    it.done ? "text-[var(--pine)]" : "text-[var(--muted)]"
                  )}
                >
                  {it.done ? "✓" : "—"}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/profile"
              className="rounded-full bg-[var(--pine)] px-4 py-2 text-sm font-medium text-[var(--paper)]"
            >
              Finish setup
            </Link>
            <Link
              href="/profile"
              className="rounded-full border border-[var(--border)] bg-white/50 px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-white/70"
            >
              Edit profile
            </Link>
          </div>
        </div>

        {/* Clubs (multi-club membership) */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 shadow-[0_10px_28px_rgba(17,19,18,.06)]">
          <div className="flex items-center justify-between">
            <div className="text-xs tracking-[0.22em] text-[var(--muted)]">CLUBS</div>
            <Link href="/clubs" className="text-sm font-medium text-[var(--pine)] hover:underline">
              Manage
            </Link>
          </div>

          {clubs.length === 0 ? (
            <div className="mt-3 text-sm text-[var(--muted)]">
              Add a club to unlock club-only ladders and verification.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {clubs.slice(0, 4).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted)]">
                      {c.verified ? "Verified" : "Unverified"}
                    </div>
                  </div>
                  <div
                    className={cx(
                      "h-2 w-2 rounded-full",
                      c.verified ? "bg-[var(--pine)]" : "bg-[rgba(17,19,18,.25)]"
                    )}
                  />
                </div>
              ))}
              {clubs.length > 4 ? (
                <div className="pt-1 text-xs text-[var(--muted)]">
                  +{clubs.length - 4} more
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 shadow-[0_10px_28px_rgba(17,19,18,.06)]">
          <details>
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs tracking-[0.22em] text-[var(--muted)]">
                    HOW IT WORKS
                  </div>
                  <div className="mt-2 text-lg font-semibold">Clean terms</div>
                </div>
                <div className="text-xs text-[var(--muted)]">▾</div>
              </div>
              <div className="mt-2 text-sm text-[var(--muted)]">
                Host proposes. Invitee accepts/denies. Scoring opens after acceptance.
              </div>
            </summary>

            <div className="mt-4 space-y-2 text-sm text-[var(--muted)]">
              <div>• Propose a match inside a club.</div>
              <div>• Opponent accepts → match becomes active.</div>
              <div>• Post scores → match completes and records.</div>
            </div>
          </details>
        </div>
      </aside>
    </div>
  );
}