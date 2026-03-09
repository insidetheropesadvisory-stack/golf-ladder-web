"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";

type MatchStatus = "proposal" | "active" | "completed";
type Focus = "needs" | "active" | "proposed" | null;

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
  terms_last_proposed_at: string | null;
  round_time: string | null;
  terms_denied_by: string | null;
};

type PlayerLite = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

type ProfileMe = {
  id?: string;
  displayName?: string;
  avatarUrl?: string | null;
  handicap?: number | null;
  hasName?: boolean;
};

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmtFormat(f: string) {
  const s = String(f ?? "").toLowerCase();
  if (s === "match_play") return "Match Play";
  if (s === "stroke_play") return "Stroke Play";
  return s ? s.replaceAll("_", " ") : "—";
}

function initials(name?: string) {
  const s = (name ?? "").trim();
  if (!s) return "GL";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function deriveBucket(r: MatchRow): MatchStatus {
  if (r.completed) return "completed";
  const ts = String(r.terms_status ?? "").toLowerCase();
  if (ts === "accepted") return "active";
  if (ts === "pending" || ts === "denied") return "proposal";
  const s = String(r.status ?? "").toLowerCase();
  if (["proposed", "proposal", "pending", "invite", "invited"].includes(s)) {
    return "proposal";
  }
  if (["complete", "completed", "final", "finished", "closed"].includes(s)) {
    return "completed";
  }
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

function whenLabel(row: MatchRow, meId: string) {
  if (!row.round_time) {
    return needsMyAction(row, meId) ? "Pick a time" : "Awaiting time";
  }

  try {
    return new Date(row.round_time).toLocaleString();
  } catch {
    return row.round_time;
  }
}

function statusChip(row: MatchRow, meId: string) {
  const bucket = deriveBucket(row);
  const ts = String(row.terms_status ?? "").toLowerCase();

  if (bucket === "completed") return { label: "Final", tone: "quiet" as const };
  if (bucket === "active") return { label: "Active", tone: "active" as const };

  if (ts === "denied") {
    return {
      label: meId === row.creator_id ? "Update terms" : "Waiting",
      tone: "warn" as const,
    };
  }

  if (needsMyAction(row, meId)) {
    return { label: "Needs your response", tone: "warn" as const };
  }

  return { label: "Waiting", tone: "quiet" as const };
}

function primaryCta(row: MatchRow, meId: string) {
  const bucket = deriveBucket(row);

  if (bucket === "completed") return "View result";

  if (bucket === "active") {
    if (!row.round_time) {
      return needsMyAction(row, meId) ? "Pick a time" : "View details";
    }

    const t = new Date(row.round_time).getTime();
    const now = Date.now();
    if (Number.isFinite(t) && t < now - 2 * 60 * 60 * 1000) return "Enter score";
    return "View details";
  }

  return needsMyAction(row, meId) ? "Review" : "Open";
}

function Pill({
  tone,
  label,
}: {
  tone: "active" | "warn" | "quiet";
  label: string;
}) {
  const cls =
    tone === "active"
      ? "bg-[rgba(11,59,46,.12)] text-[var(--pine)]"
      : tone === "warn"
      ? "bg-[rgba(180,140,60,.16)] text-[rgba(120,82,18,.95)]"
      : "bg-[rgba(17,19,18,.06)] text-[rgba(17,19,18,.70)]";

  return <span className={cx("rounded-full px-3 py-1 text-xs font-medium", cls)}>{label}</span>;
}

function Avatar({
  name,
  url,
  size = 40,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--border)] bg-white/60"
      style={{ width: size, height: size }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[var(--pine)]">
          {initials(name)}
        </div>
      )}
    </div>
  );
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

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={opponent.name} url={opponent.avatarUrl} size={44} />
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{opponent.name}</div>
            <div className="mt-1 text-sm text-[var(--muted)]">
              {row.course_name} • {fmtFormat(row.format)}
              {row.use_handicap ? " (Net)" : " (Gross)"} • {whenLabel(row, meId)}
            </div>
          </div>
        </div>

        <div className="shrink-0">
          <Pill tone={chip.tone} label={chip.label} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/matches/${row.id}`}
          className="rounded-full bg-[var(--pine)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:-translate-y-[1px]"
        >
          {primaryCta(row, meId)}
        </Link>

        {row.creator_id === meId && !row.opponent_id ? (
          <span className="text-xs text-[var(--muted)]">Invite pending</span>
        ) : null}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [me, setMe] = useState<ProfileMe>({
    displayName: "Player",
    avatarUrl: null,
    handicap: null,
    hasName: false,
  });

  const [meId, setMeId] = useState<string | null>(null);

  const [rows, setRows] = useState<MatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerLite>>({});

  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [formatFilter, setFormatFilter] = useState<"all" | "stroke_play" | "match_play">("all");
  const [sort, setSort] = useState<"action" | "newest" | "scheduled">("action");

  const [focus, setFocus] = useState<Focus>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focus && focusRef.current) {
      setTimeout(() => {
        focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }, [focus]);

  useEffect(() => {
    let mounted = true;

    async function run(sessionUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }, authToken?: string) {
      try {
        if (!mounted) return;
        setLoading(true);
        setFatal(null);

        const meta = (sessionUser.user_metadata ?? {}) as Record<string, unknown>;
        const metaName = String(
          meta.display_name ?? meta.name ?? meta.full_name ?? meta.username ?? ""
        ).trim();
        const sessionMetaHcp = toNumberOrNull((meta as any).handicap_index);

        if (!mounted) return;
        setMeId(sessionUser.id);

        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("id, display_name, handicap_index, avatar_url")
          .eq("id", sessionUser.id)
          .maybeSingle();

        if (profErr) console.warn("profiles fetch warning:", profErr);

        const nameRaw = String((prof as any)?.display_name ?? "").trim();
        const displayName = nameRaw || metaName || "Player";
        const handicap = toNumberOrNull((prof as any)?.handicap_index) ?? sessionMetaHcp;

        if (!mounted) return;
        setMe({
          id: sessionUser.id,
          displayName,
          handicap,
          avatarUrl: (prof as any)?.avatar_url ?? null,
          hasName: Boolean(nameRaw || metaName),
        });

        const email = (sessionUser.email ?? "").trim();
        const orClause = [
          `creator_id.eq.${sessionUser.id}`,
          `opponent_id.eq.${sessionUser.id}`,
          email ? `opponent_email.ilike.${email}` : null,
        ]
          .filter(Boolean)
          .join(",");

        const { data: m, error: mErr } = await supabase
          .from("matches")
          .select(
            "id,created_at,creator_id,opponent_id,opponent_email,course_name,completed,status,format,use_handicap,terms_status,terms_last_proposed_by,terms_last_proposed_at,terms_denied_by,round_time"
          )
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
              .filter((id) => id && id !== sessionUser.id)
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
        } else if (mounted) {
          setPlayers({});
        }

        if (!mounted) return;
        setLoading(false);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setFatal(e?.message ?? "Unknown error");
        setLoading(false);
      }
    }

    let handled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      handled = true;
      if (session?.user) {
        run(session.user, session.access_token);
      } else {
        setFatal("Auth session missing");
        setLoading(false);
      }
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && mounted && session?.user) {
        run(session.user, session.access_token);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const courses = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const c = String(r.course_name ?? "").trim();
      if (c) s.add(c);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  function opponentFor(row: MatchRow) {
    const myId = meId ?? "";
    const oppId = myId === row.creator_id ? row.opponent_id : row.creator_id;
    const p = oppId ? players[String(oppId)] : null;

    const name =
      (p?.display_name && String(p.display_name).trim()) ||
      (myId === row.creator_id && !row.opponent_id ? "Invite pending" : "Opponent");

    const avatarUrl = p?.avatar_url ?? null;
    return { name, avatarUrl };
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const myId = meId ?? "";

    return rows.filter((r) => {
      if (courseFilter !== "all" && r.course_name !== courseFilter) return false;
      if (formatFilter !== "all" && String(r.format) !== formatFilter) return false;

      if (!q) return true;

      const opp = opponentFor(r).name.toLowerCase();
      const course = String(r.course_name ?? "").toLowerCase();
      const when = whenLabel(r, myId).toLowerCase();
      return opp.includes(q) || course.includes(q) || when.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, courseFilter, formatFilter, players, meId]);

  const buckets = useMemo(() => {
    const myId = meId ?? "";
    const proposed = filtered.filter((r) => deriveBucket(r) === "proposal");
    const active = filtered.filter((r) => deriveBucket(r) === "active");
    const completed = filtered.filter((r) => deriveBucket(r) === "completed");

    const actionNeeded = proposed.filter((r) => needsMyAction(r, myId));

    const nextUp = [...active].sort((a, b) => {
      const ta = a.round_time ? new Date(a.round_time).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.round_time ? new Date(b.round_time).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    const recent = [...completed].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    const proposedSorted = [...proposed].sort((a, b) => {
      if (sort === "scheduled") {
        const ta = a.round_time ? new Date(a.round_time).getTime() : Number.POSITIVE_INFINITY;
        const tb = b.round_time ? new Date(b.round_time).getTime() : Number.POSITIVE_INFINITY;
        return ta - tb;
      }

      if (sort === "newest") {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      }

      const aa = needsMyAction(a, myId) ? 0 : 1;
      const bb = needsMyAction(b, myId) ? 0 : 1;
      if (aa !== bb) return aa - bb;

      const ta = new Date(a.terms_last_proposed_at ?? a.created_at).getTime();
      const tb = new Date(b.terms_last_proposed_at ?? b.created_at).getTime();
      return tb - ta;
    });

    return {
      proposed: proposedSorted,
      active: nextUp,
      completed: recent,
      actionNeeded,
    };
  }, [filtered, meId, sort]);

  const canCreateMatch = Boolean(me.hasName);
  const newMatchHref = canCreateMatch
    ? "/matches/new"
    : "/profile?next=/matches/new&reason=name_required";

  const focusedList = useMemo(() => {
    if (!meId) return [];
    if (focus === "needs") return buckets.actionNeeded;
    if (focus === "active") return buckets.active;
    if (focus === "proposed") return buckets.proposed;
    return [];
  }, [focus, buckets, meId]);

  const [openClub, setOpenClub] = useState<string>("all");
  const [openWindow, setOpenWindow] = useState<"7" | "14" | "30">("14");
  const openMatches: MatchRow[] = [];

  return (
    <div>
      <div className="space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] tracking-[0.28em] text-[var(--muted)]">
              RECIPROCITY
            </div>
            <h1 className="mt-2 text-2xl font-serif font-semibold tracking-tight sm:text-3xl">Home</h1>
          </div>

          <details className="relative">
            <summary className="list-none cursor-pointer">
              <Avatar name={me.displayName ?? "Player"} url={me.avatarUrl} size={44} />
            </summary>

            <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_16px_40px_rgba(17,19,18,.12)]">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <div className="truncate text-sm font-semibold">{me.displayName ?? "Player"}</div>
                <div className="text-xs text-[var(--muted)]">
                  {me.handicap != null ? `HCP: ${me.handicap}` : "No handicap set"}
                </div>
              </div>
              <div className="p-2">
                <Link
                  className="block rounded-xl px-3 py-2 text-sm hover:bg-black/5"
                  href="/profile"
                >
                  Profile
                </Link>
                <Link
                  className="block rounded-xl px-3 py-2 text-sm hover:bg-black/5"
                  href="/logout"
                >
                  Sign out
                </Link>
              </div>
            </div>
          </details>
        </div>

        {!canCreateMatch ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-6">
            <div className="text-sm font-semibold">Finish setup</div>
            <div className="mt-2 text-sm text-[var(--muted)]">
              Add your display name so opponents see who they’re playing. Then you can
              create matches.
            </div>
            <div className="mt-4">
              <Link className="text-sm underline" href={newMatchHref}>
                Go to Profile →
              </Link>
            </div>
          </div>
        ) : null}

        {fatal ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {fatal}
          </div>
        ) : null}

        {(() => {
          const tiles: ReadonlyArray<{
            label: string;
            value: number;
            key: Exclude<Focus, null>;
          }> = [
            { label: "Needs action", value: buckets.actionNeeded.length, key: "needs" },
            { label: "Active", value: buckets.active.length, key: "active" },
            { label: "Proposed", value: buckets.proposed.length, key: "proposed" },
          ];

          return (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {tiles.map((t) => {
                const active = focus === t.key;

                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFocus((cur) => (cur === t.key ? null : t.key))}
                    className={cx(
                      "group rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 text-left shadow-[var(--shadow)] transition",
                      active
                        ? "ring-1 ring-[rgba(176,141,87,.55)]"
                        : "hover:-translate-y-[1px] hover:shadow-[0_14px_40px_rgba(17,19,18,.10)]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {t.label}
                        </div>
                        <div className="mt-2 text-3xl font-semibold tabular-nums text-[var(--ink)]">
                          {t.value}
                        </div>
                      </div>

                      <div
                        className={cx(
                          "mt-1 text-lg text-[var(--muted)] transition",
                          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        aria-hidden="true"
                      >
                        ›
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {focus ? (
          <div
            ref={focusRef}
            className="space-y-4 rounded-2xl border border-[var(--border)] bg-white/60 p-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-serif font-semibold">
                {focus === "needs"
                  ? "Needs action"
                  : focus === "active"
                  ? "Active"
                  : "Proposed"}
              </h2>
              <button
                type="button"
                className="text-sm text-[var(--muted)] underline"
                onClick={() => setFocus(null)}
              >
                Clear
              </button>
            </div>

            {focusedList.length === 0 ? (
              <div className="text-sm text-[var(--muted)]">You’re all caught up.</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {focusedList.slice(0, 8).map((r) => (
                  <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
                ))}
              </div>
            )}
          </div>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-serif font-semibold">Open matches near you</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Pool model preview (coming soon).
              </p>
            </div>

            <button
              type="button"
              disabled
              className="rounded-full border border-[var(--border)] bg-white/60 px-4 py-2 text-sm font-medium text-[var(--muted)] opacity-70"
              title="Coming soon"
            >
              Browse all open matches
            </button>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={openClub}
                onChange={(e) => setOpenClub(e.target.value)}
                className="rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-sm"
              >
                <option value="all">All clubs</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={openWindow}
                onChange={(e) => setOpenWindow(e.target.value as any)}
                className="rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-sm"
              >
                <option value="7">Next 7 days</option>
                <option value="14">Next 14 days</option>
                <option value="30">Next 30 days</option>
              </select>

              <span className="ml-1 text-xs text-[var(--muted)]">
                ({openClub}, {openWindow}d)
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {loading ? (
                <>
                  <div className="rounded-xl border border-[var(--border)] bg-white/40 p-4 text-sm text-[var(--muted)]">
                    Loading…
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-white/40 p-4 text-sm text-[var(--muted)]">
                    Loading…
                  </div>
                </>
              ) : openMatches.length === 0 ? (
                <div className="text-sm text-[var(--muted)]">
                  No open matches yet. Pool is coming soon.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-serif font-semibold">Next up</h2>

          {loading ? (
            <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5 text-sm text-[var(--muted)]">
              Loading…
            </div>
          ) : buckets.active.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5 text-sm text-[var(--muted)]">
              No active matches yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {buckets.active.slice(0, 2).map((r) => (
                <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-serif font-semibold">Needs action</h2>

          {loading ? null : buckets.actionNeeded.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5 text-sm text-[var(--muted)]">
              You’re all caught up.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {buckets.actionNeeded.slice(0, 4).map((r) => (
                <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
              ))}
            </div>
          )}
        </section>

        <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-sm outline-none md:w-72"
              placeholder="Search opponent or course…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-sm"
              >
                <option value="all">All courses</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={formatFilter}
                onChange={(e) => setFormatFilter(e.target.value as any)}
                className="rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-sm"
              >
                <option value="all">All formats</option>
                <option value="stroke_play">Stroke Play</option>
                <option value="match_play">Match Play</option>
              </select>

              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as any)}
                className="rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-sm"
              >
                <option value="action">Sort: Action needed</option>
                <option value="newest">Sort: Newest</option>
                <option value="scheduled">Sort: Scheduled</option>
              </select>
            </div>
          </div>
        </div>

        <section className="space-y-3">
          <details className="rounded-2xl border border-[var(--border)] bg-white/60 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-serif font-semibold">Proposed</h2>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-[var(--muted)]">
                  {buckets.proposed.length}
                </span>
              </div>
              <span className="text-xs text-[var(--muted)]">Toggle</span>
            </summary>

            <div className="mt-4">
              {buckets.proposed.length === 0 ? (
                <div className="text-sm text-[var(--muted)]">No proposed matches.</div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {buckets.proposed.map((r) => (
                    <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
                  ))}
                </div>
              )}
            </div>
          </details>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-serif font-semibold">Recent results</h2>
          {buckets.completed.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5 text-sm text-[var(--muted)]">
              No completed matches yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {buckets.completed.slice(0, 4).map((r) => (
                <MatchCard key={r.id} row={r} meId={meId ?? ""} opponent={opponentFor(r)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}