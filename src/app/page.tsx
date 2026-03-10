"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type MatchRow = {
  id: string;
  created_at: string;
  creator_id: string;
  opponent_id: string | null;
  opponent_email: string;
  course_name: string;
  completed: boolean;
  status: string | null;
  format: "stroke_play" | "match_play" | string;
  use_handicap: boolean;
  terms_status: "pending" | "accepted" | "denied" | string;
  terms_last_proposed_by: string | null;
  round_time: string | null;
  is_ladder_match: boolean;
};

type PlayerLite = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

function deriveBucket(r: MatchRow): "proposal" | "active" | "completed" {
  if (r.completed) return "completed";
  const ts = String(r.terms_status ?? "").toLowerCase();
  if (ts === "accepted") return "active";
  if (ts === "pending" || ts === "denied") return "proposal";
  const s = String(r.status ?? "").toLowerCase();
  if (["proposed", "proposal", "pending", "invite", "invited"].includes(s)) return "proposal";
  if (["complete", "completed", "final", "finished", "closed"].includes(s)) return "completed";
  return "active";
}

function needsMyAction(r: MatchRow, meId: string) {
  if (r.completed) return false;
  const ts = String(r.terms_status ?? "").toLowerCase();
  if (ts === "denied") return r.creator_id === meId;
  if (ts === "pending") {
    if (r.terms_last_proposed_by) return r.terms_last_proposed_by !== meId;
    return r.creator_id !== meId;
  }
  return false;
}

function fmtFormat(f: string) {
  if (f === "match_play") return "Match Play";
  if (f === "stroke_play") return "Stroke Play";
  return f ? f.replaceAll("_", " ") : "—";
}

function statusChip(row: MatchRow, meId: string) {
  const bucket = deriveBucket(row);
  if (bucket === "completed") return { label: "Final", tone: "quiet" as const };
  if (bucket === "active") return { label: "Active", tone: "active" as const };
  if (needsMyAction(row, meId)) return { label: "Needs response", tone: "warn" as const };
  return { label: "Waiting", tone: "quiet" as const };
}

function primaryCta(row: MatchRow, meId: string) {
  const bucket = deriveBucket(row);
  if (bucket === "completed") return "View result";
  if (bucket === "active") return "View match";
  return needsMyAction(row, meId) ? "Review" : "Open";
}

function Pill({ tone, label }: { tone: "active" | "warn" | "quiet"; label: string }) {
  const cls =
    tone === "active"
      ? "bg-[rgba(11,59,46,.12)] text-[var(--pine)]"
      : tone === "warn"
      ? "bg-[rgba(180,140,60,.16)] text-[rgba(120,82,18,.95)]"
      : "bg-[rgba(17,19,18,.06)] text-[rgba(17,19,18,.70)]";

  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function MatchCard({
  row,
  meId,
  opponent,
}: {
  row: MatchRow;
  meId: string;
  opponent: { name: string; avatarUrl: string | null };
}) {
  const chip = statusChip(row, meId);
  const when = row.round_time
    ? new Date(row.round_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <Link
      href={`/matches/${row.id}`}
      className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 p-4 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
    >
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white">
        {opponent.avatarUrl ? (
          <img src={opponent.avatarUrl} alt={opponent.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs font-semibold">
            {initials(opponent.name)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{opponent.name}</span>
          {row.is_ladder_match && (
            <span className="rounded-full bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Ladder</span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-[var(--muted)]">
          {row.course_name} {fmtFormat(row.format)}{row.use_handicap ? " (Net)" : ""}
          {when ? ` — ${when}` : ""}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <Pill tone={chip.tone} label={chip.label} />
        <span className="text-xs font-medium text-[var(--pine)] opacity-0 transition group-hover:opacity-100">
          {primaryCta(row, meId)} →
        </span>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Player");
  const [hasName, setHasName] = useState(false);
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerLite>>({});

  useEffect(() => {
    let mounted = true;

    async function run(sessionUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }, authToken?: string) {
      try {
        if (!mounted) return;
        setLoading(true);
        setFatal(null);
        setMeId(sessionUser.id);

        const meta = (sessionUser.user_metadata ?? {}) as Record<string, unknown>;
        const metaName = String(meta.display_name ?? meta.name ?? "").trim();

        const { data: prof } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", sessionUser.id)
          .maybeSingle();

        const nameRaw = String((prof as any)?.display_name ?? "").trim();
        if (mounted) {
          setDisplayName(nameRaw || metaName || "Player");
          setHasName(Boolean(nameRaw || metaName));
        }

        const email = (sessionUser.email ?? "").trim();
        const orClause = [
          `creator_id.eq.${sessionUser.id}`,
          `opponent_id.eq.${sessionUser.id}`,
          email ? `opponent_email.ilike.${email}` : null,
        ].filter(Boolean).join(",");

        const { data: m, error: mErr } = await supabase
          .from("matches")
          .select("id,created_at,creator_id,opponent_id,opponent_email,course_name,completed,status,format,use_handicap,terms_status,terms_last_proposed_by,round_time,is_ladder_match")
          .or(orClause)
          .order("created_at", { ascending: false });

        if (mErr) throw new Error(mErr.message);
        const matchRows = (m ?? []) as MatchRow[];
        if (!mounted) return;
        setRows(matchRows);

        const ids = Array.from(
          new Set(
            matchRows
              .flatMap((r) => [r.creator_id, r.opponent_id].filter(Boolean) as string[])
              .filter((id) => id !== sessionUser.id)
          )
        );

        if (ids.length > 0) {
          const res = await fetch("/api/players/lookup", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({ ids }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.players && mounted) {
            setPlayers(json.players as Record<string, PlayerLite>);
          }
        }

        if (mounted) setLoading(false);
      } catch (e: any) {
        if (!mounted) return;
        setFatal(e?.message ?? "Unknown error");
        setLoading(false);
      }
    }

    let handled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      handled = true;
      if (session?.user) run(session.user, session.access_token);
      else { setFatal("Auth session missing"); setLoading(false); }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && mounted && session?.user) run(session.user, session.access_token);
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  function opponentFor(row: MatchRow) {
    const myId = meId ?? "";
    const oppId = myId === row.creator_id ? row.opponent_id : row.creator_id;
    const p = oppId ? players[String(oppId)] : null;
    const name = p?.display_name?.trim() || (myId === row.creator_id && !row.opponent_id ? "Invite pending" : "Opponent");
    return { name, avatarUrl: p?.avatar_url ?? null };
  }

  const buckets = useMemo(() => {
    const myId = meId ?? "";
    const proposed = rows.filter((r) => deriveBucket(r) === "proposal");
    const active = rows.filter((r) => deriveBucket(r) === "active");
    const completed = rows.filter((r) => deriveBucket(r) === "completed");
    const actionNeeded = proposed.filter((r) => needsMyAction(r, myId));

    const nextUp = [...active].sort((a, b) => {
      const ta = a.round_time ? new Date(a.round_time).getTime() : Infinity;
      const tb = b.round_time ? new Date(b.round_time).getTime() : Infinity;
      return ta - tb;
    });

    const recent = [...completed].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return { proposed, active: nextUp, completed: recent, actionNeeded };
  }, [rows, meId]);

  const canCreateMatch = hasName;
  const newMatchHref = canCreateMatch ? "/matches/new" : "/profile?next=/matches/new&reason=name_required";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-[11px] tracking-[0.28em] text-[var(--muted)]">RECIPROCITY</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Welcome back{displayName !== "Player" ? `, ${displayName}` : ""}
        </h1>
      </div>

      {fatal && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{fatal}</div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Needs action", value: buckets.actionNeeded.length, href: "/matches" },
          { label: "Active", value: buckets.active.length, href: "/matches" },
          { label: "Completed", value: buckets.completed.length, href: "/matches" },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-4 shadow-[var(--shadow)] transition hover:-translate-y-[1px] hover:shadow-[0_14px_40px_rgba(17,19,18,.10)]"
          >
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">{t.value}</div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3">
        <Link
          href={newMatchHref}
          className="flex-1 rounded-xl bg-[var(--pine)] px-4 py-3 text-center text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)]"
        >
          New match
        </Link>
        <Link
          href="/matches/new?mode=link"
          className="flex-1 rounded-xl border-2 border-[var(--pine)]/30 bg-[var(--pine)]/5 px-4 py-3 text-center text-sm font-semibold text-[var(--pine)] transition hover:-translate-y-[1px] hover:shadow-sm"
        >
          Invite a friend
        </Link>
      </div>
      <Link
        href="/ladder"
        className="block rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-center text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-[1px] hover:shadow-sm"
      >
        View ladder
      </Link>

      {/* Needs action */}
      {!loading && buckets.actionNeeded.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Needs action</h2>
          <div className="space-y-2">
            {buckets.actionNeeded.slice(0, 4).map((r) => (
              <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
            ))}
          </div>
        </section>
      )}

      {/* Next up */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Next up</h2>
        {loading ? (
          <div className="space-y-2">
            <div className="h-16 rounded-xl bg-black/[0.03]" />
            <div className="h-16 rounded-xl bg-black/[0.03]" />
          </div>
        ) : buckets.active.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4 text-sm text-[var(--muted)]">
            No active matches.{" "}
            <Link href={newMatchHref} className="font-medium text-[var(--pine)] underline">
              Create one
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {buckets.active.slice(0, 3).map((r) => (
              <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
            ))}
            {buckets.active.length > 3 && (
              <Link href="/matches" className="block text-center text-xs font-medium text-[var(--pine)]">
                View all {buckets.active.length} active matches →
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Recent results */}
      {!loading && buckets.completed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Recent results</h2>
          <div className="space-y-2">
            {buckets.completed.slice(0, 3).map((r) => (
              <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
            ))}
            {buckets.completed.length > 3 && (
              <Link href="/matches" className="block text-center text-xs font-medium text-[var(--pine)]">
                View all results →
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
