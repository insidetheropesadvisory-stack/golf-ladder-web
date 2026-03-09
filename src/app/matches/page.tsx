"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";

type AnyRow = Record<string, any>;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function emailToName(email: string) {
  const base = (email || "").split("@")[0] || "Opponent";
  return base.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatLabel(format?: string) {
  if (format === "match_play") return "Match Play";
  return "Stroke Play";
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "active" | "proposed" | "done";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-black/5 text-black/70 border-black/10",
    active: "bg-emerald-900/10 text-emerald-900 border-emerald-900/20",
    proposed: "bg-amber-900/10 text-amber-900 border-amber-900/20",
    done: "bg-slate-900/10 text-slate-900 border-slate-900/20",
  };

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

function TopoPattern() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.08]" aria-hidden="true">
      <defs>
        <pattern id="topo" width="160" height="160" patternUnits="userSpaceOnUse">
          <path
            d="M10,30 C40,10 70,10 100,30 C130,50 150,50 170,30"
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
          <path
            d="M-10,70 C20,50 60,55 90,75 C120,95 150,95 180,70"
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
          <path
            d="M10,110 C45,90 70,95 95,115 C120,135 150,135 170,110"
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
          <circle cx="120" cy="45" r="2" fill="black" />
          <circle cx="55" cy="95" r="2" fill="black" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#topo)" />
    </svg>
  );
}

export default function MatchesPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const [me, setMe] = useState<{ id: string; email: string | null } | null>(null);
  const [matches, setMatches] = useState<AnyRow[]>([]);
  const [clubs, setClubs] = useState<AnyRow[]>([]);
  const [showProposed, setShowProposed] = useState(false);
  const [query, setQuery] = useState("");
  const [myHoleCounts, setMyHoleCounts] = useState<Record<string, number>>({});

  const loadPage = useCallback(async (sessionUser: { id: string; email?: string | null }) => {
    try {
      setLoading(true);
      setStatus(null);
      setSignedOut(false);
      setMe({ id: sessionUser.id, email: sessionUser.email ?? null });

      const { data: matchData, error: matchErr } = await supabase
        .from("matches")
        .select("*")
        .order("created_at", { ascending: false });

      if (matchErr) {
        setStatus(matchErr.message);
        setLoading(false);
        return;
      }

      const m = (matchData ?? []) as AnyRow[];
      setMatches(m);

      const { data: clubData, error: clubErr } = await supabase
        .from("clubs")
        .select("*")
        .limit(12);

      if (!clubErr && clubData) {
        setClubs(clubData as AnyRow[]);
      } else if (clubErr) {
        console.warn("clubs load error:", clubErr.message);
      }

      const ids = m.map((row) => row.id).filter(Boolean);

      if (ids.length > 0) {
        const { data: holeData, error: holeErr } = await supabase
          .from("holes")
          .select("match_id, hole_no, strokes, player_id")
          .in("match_id", ids)
          .eq("player_id", sessionUser.id);

        if (!holeErr && holeData) {
          const counts: Record<string, number> = {};
          for (const r of holeData as AnyRow[]) {
            if (r.match_id && typeof r.strokes === "number") {
              counts[r.match_id] = (counts[r.match_id] ?? 0) + 1;
            }
          }
          setMyHoleCounts(counts);
        } else if (holeErr) {
          console.warn("hole progress load error:", holeErr.message);
        }
      } else {
        setMyHoleCounts({});
      }

      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to load matches");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let handled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      if (session?.user) {
        loadPage(session.user);
      } else {
        setSignedOut(true);
        setMe(null);
        setMatches([]);
        setClubs([]);
        setMyHoleCounts({});
        setLoading(false);
      }
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && session?.user) {
        loadPage(session.user);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadPage]);

  const { proposed, active, completed } = useMemo(() => {
    const proposed: AnyRow[] = [];
    const completed: AnyRow[] = [];
    const active: AnyRow[] = [];

    for (const m of matches) {
      const isCompleted = Boolean(m.completed) || m.status === "completed";
      const isProposed = m.status === "proposed" || m.terms_status === "pending";

      if (isCompleted) completed.push(m);
      else if (isProposed) proposed.push(m);
      else active.push(m);
    }

    return { proposed, active, completed };
  }, [matches]);

  const filteredActive = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;

    return active.filter((m) => {
      const opponent = String(m.opponent_email ?? "").toLowerCase();
      const course = String(m.course_name ?? "").toLowerCase();
      const status = String(m.status ?? "").toLowerCase();
      return opponent.includes(q) || course.includes(q) || status.includes(q);
    });
  }, [active, query]);

  const stats = useMemo(
    () => [
      { label: "Active", value: active.length },
      { label: "Proposed", value: proposed.length },
      { label: "Completed", value: completed.length },
    ],
    [active.length, proposed.length, completed.length]
  );

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="h-36 rounded-3xl border bg-white/60" />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="h-20 rounded-2xl border bg-white/60" />
            <div className="h-20 rounded-2xl border bg-white/60" />
            <div className="h-20 rounded-2xl border bg-white/60" />
          </div>
          <div className="mt-6 h-64 rounded-3xl border bg-white/60" />
        </div>
      </main>
    );
  }

  if (signedOut) {
    return (
      <main className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-3xl border bg-white/70 p-8 text-center backdrop-blur">
            <div className="text-xs font-medium tracking-widest text-black/55">
              RECIPROCITY
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Sign in required
            </h1>
            <p className="mt-2 text-sm text-black/60">
              Sign in to load your matches, clubs, and score progress.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center rounded-xl border bg-emerald-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }
  
  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="relative overflow-hidden rounded-3xl border bg-white/65 backdrop-blur">
          <TopoPattern />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-medium tracking-widest text-black/55">
                  RECIPROCITY
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                  Matches
                </h1>
                <p className="mt-1 text-sm text-black/60">
                  Clean score entry, club-first organization, and a proper old-money feel.
                </p>
              </div>
            </div>
          </div>
        </div>
  
        <div className="grid gap-4 sm:grid-cols-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border bg-white/65 p-4 backdrop-blur"
            >
              <div className="text-xs font-medium tracking-widest text-black/55">
                {s.label.toUpperCase()}
              </div>
              <div className="mt-1 text-2xl font-semibold">{s.value}</div>
            </div>
          ))}
        </div>

        {active.length > 0 && (
          <div className="rounded-3xl border bg-white/65 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Active</div>
              <Badge tone="active">{active.length}</Badge>
            </div>

            {active.length > 4 && (
              <div className="mt-3">
                <input
                  className="w-full rounded-2xl border bg-white/70 px-3 py-2 text-sm outline-none focus:bg-white"
                  placeholder="Search active matches…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}

            <div className="mt-4 grid gap-3">
              {filteredActive.map((m) => {
                const holesPlayed = myHoleCounts[m.id] ?? 0;
                return (
                  <Link
                    key={m.id}
                    href={`/matches/${m.id}`}
                    className="rounded-2xl border bg-white/80 p-4 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {m.course_name ?? "Course"}
                        </div>
                        <div className="text-xs text-black/55">
                          vs {emailToName(String(m.opponent_email ?? ""))}
                          {" · "}{formatLabel(m.format)}
                          {holesPlayed > 0 && ` · ${holesPlayed}/18 holes`}
                        </div>
                      </div>
                      <Badge tone="active">Active</Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {proposed.length > 0 && (
          <div className="rounded-3xl border bg-white/65 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Proposed</div>
              <Badge tone="proposed">{proposed.length}</Badge>
            </div>
            <div className="mt-4 grid gap-3">
              {proposed.map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="rounded-2xl border bg-white/80 p-4 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {m.course_name ?? "Course"}
                      </div>
                      <div className="text-xs text-black/55">
                        vs {emailToName(String(m.opponent_email ?? ""))}
                        {" · "}{formatLabel(m.format)}
                      </div>
                    </div>
                    <Badge tone="proposed">Proposed</Badge>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {completed.length > 0 && (
          <div className="rounded-3xl border bg-white/65 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Completed</div>
              <Badge tone="done">{completed.length}</Badge>
            </div>
            <div className="mt-4 grid gap-3">
              {completed.slice(0, 6).map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="rounded-2xl border bg-white/80 p-4 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {m.course_name ?? "Course"}
                      </div>
                      <div className="text-xs text-black/55">
                        vs {emailToName(String(m.opponent_email ?? ""))}
                      </div>
                    </div>
                    <Badge tone="done">Done</Badge>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {matches.length === 0 && !status && (
          <div className="rounded-3xl border bg-white/65 p-8 text-center backdrop-blur">
            <div className="text-sm font-semibold">No matches yet</div>
            <p className="mt-1 text-sm text-black/60">
              Create your first match to get started.
            </p>
            <Link
              href="/matches/new"
              className="mt-4 inline-flex items-center rounded-xl border bg-emerald-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              New match
            </Link>
          </div>
        )}

        {status ? <div className="text-sm text-red-600">{status}</div> : null}
      </div>
    </main>
  );
  }