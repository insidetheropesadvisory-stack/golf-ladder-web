"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { CT_CLUBS } from "@/lib/data/ctClubs";

type Club = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  logo_url?: string | null;
  source: "my" | "db" | "ct";
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

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
  const a1 = await supabase.from("club_memberships").select("club_id, clubs(*)").eq("user_id", userId);
  if (!a1.error && Array.isArray(a1.data)) {
    const out: Club[] = [];
    for (const r of a1.data as any[]) {
      const clubRow = r.clubs ?? null;
      const c = normalizeClubRow(clubRow);
      if (c) out.push({ ...c, source: "my" });
    }
    if (out.length) return dedupeByName(out);
  }
  return [];
}

export function ClubPicker({
  value,
  onChange,
  userId,
  placeholder = "Search clubs…",
}: {
  value: string;
  onChange: (next: string) => void;
  userId: string;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [dbClubs, setDbClubs] = useState<Club[]>([]);
  const [query, setQuery] = useState(value);

  useEffect(() => setQuery(value), [value]);

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

  const grouped = useMemo(() => {
    const mine: Club[] = [];
    const ct: Club[] = [];
    const other: Club[] = [];

    for (const c of filtered) {
      if (c.source === "my") mine.push(c);
      else if ((c.state ?? "").toUpperCase() === "CT" || c.source === "ct") ct.push(c);
      else other.push(c);
    }
    return { mine, ct, other };
  }, [filtered]);

  function pick(name: string) {
    const n = name.trim();
    if (!n) return;
    onChange(n);
    setQuery(n);
    setOpen(false);
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
                {filtered.length === 0 && (
                  <div className="p-3 text-sm text-black/60">
                    No results. Press <span className="font-semibold">Enter</span> to use custom:{" "}
                    <span className="font-semibold">{query.trim() || "—"}</span>
                  </div>
                )}

                {grouped.mine.length > 0 && (
                  <Section title="My clubs">
                    {grouped.mine.map((c) => (
                      <ClubRow key={c.id} club={c} onPick={() => pick(c.name)} />
                    ))}
                  </Section>
                )}

                {grouped.ct.length > 0 && (
                  <Section title="Connecticut">
                    {grouped.ct.map((c) => (
                      <ClubRow key={c.id} club={c} onPick={() => pick(c.name)} />
                    ))}
                  </Section>
                )}

                {grouped.other.length > 0 && (
                  <Section title="Other">
                    {grouped.other.map((c) => (
                      <ClubRow key={c.id} club={c} onPick={() => pick(c.name)} />
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

        <div className="ml-auto text-xs text-black/45">
          {club.source === "my" ? "Member" : club.source === "db" ? "Directory" : "CT"}
        </div>
      </div>
    </button>
  );
}