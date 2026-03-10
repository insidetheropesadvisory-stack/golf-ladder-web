"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { CT_CLUBS } from "@/lib/data/ctClubs";
import { cx, initials } from "@/lib/utils";

type Club = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  logo_url?: string | null;
  source: "my" | "db" | "ct" | "api";
  guest_fee?: number | null;
  apiCourseId?: number;
};

function normalizeClubRow(row: any): Club | null {
  if (!row) return null;
  const id = String(row.id ?? row.club_id ?? "");
  const name = String(row.name ?? row.club_name ?? "");
  if (!id || !name) return null;

  return {
    id,
    name,
    city: row.city ?? row.town ?? row.location ?? null,
    state: row.state ?? null,
    logo_url: row.logo_url ?? row.logo ?? null,
    source: "db",
  };
}

function dedupeByName(list: Club[]) {
  const seen = new Set<string>();
  const out: Club[] = [];
  for (const c of list) {
    const k = c.name.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function fetchMyClubs(userId: string): Promise<Club[]> {
  const a1 = await supabase.from("club_memberships").select("club_id, guest_fee, clubs(*)").eq("user_id", userId);
  if (!a1.error && Array.isArray(a1.data)) {
    const out: Club[] = [];
    for (const r of a1.data as any[]) {
      const clubRow = r.clubs ?? null;
      const c = normalizeClubRow(clubRow);
      if (c) out.push({ ...c, source: "my", guest_fee: (r as any).guest_fee ?? null });
    }
    if (out.length) return dedupeByName(out);
  }
  return [];
}

export type ApiTeeInfo = {
  name: string;
  par?: number;
  slope?: number;
  rating?: number;
  yards?: number;
};

export function ClubPicker({
  value,
  onChange,
  onGuestFeeChange,
  onCourseApiIdChange,
  onTeesChange,
  userId,
  placeholder = "Search clubs…",
}: {
  value: string;
  onChange: (next: string) => void;
  onGuestFeeChange?: (fee: number | null) => void;
  onCourseApiIdChange?: (id: number | null) => void;
  onTeesChange?: (tees: ApiTeeInfo[]) => void;
  userId: string;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [dbClubs, setDbClubs] = useState<Club[]>([]);
  const [apiClubs, setApiClubs] = useState<Club[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [query, setQuery] = useState(value);
  const apiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setQuery(value), [value]);

  // Debounced Golf Course API search
  const searchApi = useCallback((q: string) => {
    if (apiTimerRef.current) clearTimeout(apiTimerRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setApiClubs([]);
      setApiLoading(false);
      return;
    }
    setApiLoading(true);
    apiTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/golf-courses?q=${encodeURIComponent(trimmed)}&limit=6`);
        if (!res.ok) { setApiClubs([]); setApiLoading(false); return; }
        const json = await res.json();
        const courses: any[] = json.courses ?? [];
        const clubs: Club[] = courses.map((c: any) => ({
          id: `api::${c.id}`,
          name: String(c.club_name ?? c.course_name ?? ""),
          city: c.city ?? null,
          state: c.state ?? null,
          logo_url: null,
          source: "api" as const,
          apiCourseId: c.id,
        })).filter((c) => c.name);
        setApiClubs(clubs);
      } catch {
        setApiClubs([]);
      }
      setApiLoading(false);
    }, 400);
  }, []);

  useEffect(() => {
    return () => { if (apiTimerRef.current) clearTimeout(apiTimerRef.current); };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);

      const mine = await fetchMyClubs(userId);

      const clubsRes = await supabase
        .from("clubs")
        .select("id, name, club_name, city, town, state, logo_url")
        .order("name", { ascending: true })
        .limit(800);

      const db: Club[] = [];
      if (!clubsRes.error && Array.isArray(clubsRes.data)) {
        for (const row of clubsRes.data as any[]) {
          const c = normalizeClubRow(row);
          if (c) db.push(c);
        }
      }

      if (!mounted) return;

      setMyClubs(mine);
      setDbClubs(dedupeByName(db));
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [userId]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const ctClubs: Club[] = useMemo(
    () =>
      CT_CLUBS.map((name) => ({
        id: `ct::${name}`,
        name,
        city: null,
        state: "CT",
        logo_url: null,
        source: "ct",
      })),
    []
  );

  const allForSearch: Club[] = useMemo(() => {
    // Always include CT list so you never see an empty dropdown
    return dedupeByName([...myClubs, ...dbClubs, ...ctClubs]);
  }, [myClubs, dbClubs, ctClubs]);

  const filtered: Club[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = allForSearch;

    if (!q) return base.slice(0, 60);

    return base
      .filter((c) => {
        const name = c.name.toLowerCase();
        const loc = `${c.city ?? ""} ${c.state ?? ""}`.toLowerCase();
        return name.includes(q) || loc.includes(q);
      })
      .slice(0, 60);
  }, [allForSearch, query]);

  // Dedupe API results against local clubs
  const dedupedApiClubs: Club[] = useMemo(() => {
    const localNames = new Set(allForSearch.map((c) => c.name.trim().toLowerCase()));
    return apiClubs.filter((c) => !localNames.has(c.name.trim().toLowerCase()));
  }, [apiClubs, allForSearch]);

  const grouped = useMemo(() => {
    const mine: Club[] = [];
    const ct: Club[] = [];
    const other: Club[] = [];

    for (const c of filtered) {
      if (c.source === "my") mine.push(c);
      else if ((c.state ?? "").toUpperCase() === "CT" || c.source === "ct") ct.push(c);
      else other.push(c);
    }
    return { mine, ct, other, api: dedupedApiClubs };
  }, [filtered, dedupedApiClubs]);

  async function pick(name: string, guestFee?: number | null, apiCourseId?: number | null) {
    const n = name.trim();
    if (!n) return;
    onChange(n);
    setQuery(n);
    setOpen(false);
    onGuestFeeChange?.(guestFee ?? null);
    onCourseApiIdChange?.(apiCourseId ?? null);

    // Fetch tee data for API courses
    if (apiCourseId && onTeesChange) {
      try {
        const res = await fetch(`/api/golf-courses?id=${apiCourseId}`);
        if (res.ok) {
          const json = await res.json();
          const course = json.course ?? json;
          if (course?.tees) {
            const tees: ApiTeeInfo[] = Object.entries(course.tees).map(([tName, t]: [string, any]) => ({
              name: tName,
              par: t.par ?? undefined,
              slope: t.slope ?? undefined,
              rating: t.course_rating ?? t.courseRating ?? undefined,
              yards: t.total_yards ?? t.totalYards ?? undefined,
            }));
            onTeesChange(tees);
            return;
          }
        }
      } catch {}
    }
    onTeesChange?.([]);
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="text-sm font-medium">Course / club</label>

      <div className="mt-1 rounded-2xl border bg-white/70 px-3 py-2 shadow-sm focus-within:shadow">
        <div className="flex items-center gap-2">
          <input
            className="w-full bg-transparent outline-none text-sm"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              searchApi(e.target.value);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Prevent the form from submitting; treat Enter as "use this club"
                e.preventDefault();
                pick(query);
              }
            }}
          />

          <button
            type="button"
            className="rounded-xl border bg-white/70 px-2 py-1 text-xs font-semibold hover:bg-white"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Browse"}
          </button>
        </div>

        <div className="mt-1 text-xs text-black/55">
          {value ? (
            <>
              Selected: <span className="font-semibold text-black/70">{value}</span>
            </>
          ) : (
            <>Type to search. Press Enter to use custom instantly.</>
          )}
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg">
          <div className="max-h-[360px] overflow-auto p-2">
            {loading ? (
              <div className="p-3 text-sm text-black/60">Loading clubs…</div>
            ) : (
              <>
                {filtered.length === 0 && dedupedApiClubs.length === 0 && !apiLoading && (
                  <div className="p-3 text-sm text-black/60">
                    No results. Press <span className="font-semibold">Enter</span> to use custom:{" "}
                    <span className="font-semibold">{query.trim() || "—"}</span>
                  </div>
                )}

                {grouped.mine.length > 0 && (
                  <Section title="My clubs">
                    {grouped.mine.map((c) => (
                      <ClubRow key={c.id} club={c} onPick={() => pick(c.name, c.guest_fee)} />
                    ))}
                  </Section>
                )}

                {grouped.ct.length > 0 && (
                  <Section title="Connecticut">
                    {grouped.ct.map((c) => (
                      <ClubRow key={c.id} club={c} onPick={() => pick(c.name, null)} />
                    ))}
                  </Section>
                )}

                {grouped.other.length > 0 && (
                  <Section title="Other">
                    {grouped.other.map((c) => (
                      <ClubRow key={c.id} club={c} onPick={() => pick(c.name, null)} />
                    ))}
                  </Section>
                )}

                {apiLoading && (
                  <div className="px-2 py-2 text-xs text-black/50">Searching nationwide...</div>
                )}

                {grouped.api.length > 0 && (
                  <Section title="Nationwide">
                    {grouped.api.map((c) => (
                      <ClubRow key={c.id} club={c} onPick={() => pick(c.name, null, c.apiCourseId)} />
                    ))}
                  </Section>
                )}

                <div className="mt-2">
                  <button
                    type="button"
                    className="w-full rounded-xl border bg-black/5 px-3 py-2 text-left text-sm hover:bg-black/10"
                    onClick={() => pick(query)}
                    disabled={!query.trim()}
                  >
                    Use custom: <span className="font-semibold">{query.trim() || "—"}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1 text-xs font-semibold tracking-wide text-black/55">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ClubRow({ club, onPick }: { club: Club; onPick: () => void }) {
  const crest = initials(club.name);
  const loc = [club.city, club.state].filter(Boolean).join(", ");

  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-left hover:bg-black/[0.03]"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 overflow-hidden rounded-xl border bg-emerald-950 text-white">
          {club.logo_url ? (
            <img src={club.logo_url} alt={`${club.name} logo`} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-xs font-semibold">{crest}</div>
          )}
        </div>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{club.name}</div>
          <div className="truncate text-xs text-black/55">{loc || (club.source === "ct" ? "CT club list" : "Club")}</div>
        </div>

        <div className="ml-auto shrink-0 text-right">
          <div className="text-xs text-black/45">
            {club.source === "my" ? "Member" : club.source === "db" ? "Directory" : club.source === "api" ? "API" : "CT"}
          </div>
          {club.source === "my" && club.guest_fee != null && (
            <div className="text-[10px] font-medium text-emerald-700">
              Guest: ${club.guest_fee}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}