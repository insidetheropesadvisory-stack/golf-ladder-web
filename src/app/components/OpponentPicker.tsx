"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { initials } from "@/lib/utils";

type Player = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
  clubs: string[];
};

export function OpponentPicker({
  meId,
  value,
  onChange,
}: {
  meId: string;
  value: Player | null;
  onChange: (player: Player | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [allClubs, setAllClubs] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [clubFilter, setClubFilter] = useState<string>("all");
  const [hcpFilter, setHcpFilter] = useState<string>("all");

  // Load all players and their club memberships
  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);

      // Fetch all profiles except current user
      const { data: profiles, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url, handicap_index")
        .neq("id", meId)
        .order("display_name", { ascending: true })
        .limit(500);

      if (profErr || !profiles) {
        console.warn("Failed to load players:", profErr?.message);
        setLoading(false);
        return;
      }

      // Fetch all club memberships with club names
      const { data: memberships } = await supabase
        .from("club_memberships")
        .select("user_id, clubs(name)")
        .limit(2000);

      // Build a map of user_id -> club names
      const clubMap: Record<string, string[]> = {};
      const clubSet = new Set<string>();
      if (memberships) {
        for (const m of memberships as any[]) {
          const uid = String(m.user_id);
          const clubName = m.clubs?.name;
          if (!clubName) continue;
          if (!clubMap[uid]) clubMap[uid] = [];
          clubMap[uid].push(String(clubName));
          clubSet.add(String(clubName));
        }
      }

      if (!mounted) return;

      const players: Player[] = (profiles as any[])
        .filter((p) => p.display_name?.trim()) // Only show players who have set a name
        .map((p) => ({
          id: String(p.id),
          display_name: p.display_name ?? null,
          email: p.email ?? null,
          avatar_url: p.avatar_url ?? null,
          handicap_index: p.handicap_index ?? null,
          clubs: clubMap[String(p.id)] ?? [],
        }));

      setAllPlayers(players);
      setAllClubs(Array.from(clubSet).sort((a, b) => a.localeCompare(b)));
      setLoading(false);
    })();

    return () => { mounted = false; };
  }, [meId]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return allPlayers.filter((p) => {
      // Club filter
      if (clubFilter !== "all" && !p.clubs.includes(clubFilter)) return false;

      // Handicap filter
      if (hcpFilter !== "all") {
        const hcp = p.handicap_index;
        if (hcp == null) return hcpFilter === "none";
        if (hcpFilter === "0-10" && (hcp < 0 || hcp > 10)) return false;
        if (hcpFilter === "11-20" && (hcp < 11 || hcp > 20)) return false;
        if (hcpFilter === "21-30" && (hcp < 21 || hcp > 30)) return false;
        if (hcpFilter === "30+" && hcp <= 30) return false;
        if (hcpFilter === "none") return false;
      }

      // Text search
      if (!q) return true;
      const name = (p.display_name ?? "").toLowerCase();
      const clubs = p.clubs.join(" ").toLowerCase();
      return name.includes(q) || clubs.includes(q);
    });
  }, [allPlayers, query, clubFilter, hcpFilter]);

  function pick(player: Player) {
    onChange(player);
    setQuery(player.display_name ?? "");
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
  }

  // If a player is selected, show selected state
  if (value) {
    const name = value.display_name || "Unknown";
    const crest = initials(name);

    return (
      <div className="space-y-1">
        <label className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
          OPPONENT
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-[var(--pine)]/30 bg-[var(--pine)]/5 px-4 py-3">
          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] shadow-sm">
            {value.avatar_url ? (
              <img src={value.avatar_url} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs font-semibold">{crest}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--ink)]">{name}</div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              {value.handicap_index != null && <span>HCP {value.handicap_index}</span>}
              {value.clubs.length > 0 && (
                <>
                  {value.handicap_index != null && <span className="text-[var(--border)]">&middot;</span>}
                  <span className="truncate">{value.clubs.join(", ")}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            className="rounded-full border border-[var(--border)] bg-white/80 px-3 py-1.5 text-xs font-medium transition hover:bg-white hover:shadow-sm"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative space-y-1">
      <label className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
        OPPONENT
      </label>

      <div className="rounded-xl border border-[var(--border)] bg-white/60 transition focus-within:border-[var(--pine)] focus-within:ring-1 focus-within:ring-[var(--pine)]">
        <div className="flex items-center gap-2 px-4 py-3">
          <svg className="h-4 w-4 flex-shrink-0 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            className="w-full bg-transparent text-sm outline-none"
            value={query}
            placeholder="Search players by name..."
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-2">
          <select
            className="rounded-lg border border-[var(--border)] bg-white/80 px-2.5 py-1.5 text-xs outline-none"
            value={clubFilter}
            onChange={(e) => { setClubFilter(e.target.value); setOpen(true); }}
          >
            <option value="all">All clubs</option>
            {allClubs.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            className="rounded-lg border border-[var(--border)] bg-white/80 px-2.5 py-1.5 text-xs outline-none"
            value={hcpFilter}
            onChange={(e) => { setHcpFilter(e.target.value); setOpen(true); }}
          >
            <option value="all">Any handicap</option>
            <option value="0-10">0 - 10</option>
            <option value="11-20">11 - 20</option>
            <option value="21-30">21 - 30</option>
            <option value="30+">30+</option>
            <option value="none">Not set</option>
          </select>

          <span className="text-[10px] text-[var(--muted)]">
            {filtered.length} player{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="text-xs text-[var(--muted)]">
        Search and select a player on Reciprocity to challenge.
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-lg">
          <div className="max-h-[340px] overflow-auto p-2">
            {loading ? (
              <div className="p-4 text-sm text-[var(--muted)]">Loading players...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--muted)]">
                No players found. Try adjusting your filters.
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.slice(0, 50).map((p) => {
                  const name = p.display_name || "Unknown";
                  const crest = initials(name);

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pick(p)}
                      className="w-full rounded-xl border border-transparent bg-white p-3 text-left transition hover:border-[var(--border)] hover:bg-black/[0.02] hover:shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)]">
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt={name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="grid h-full w-full place-items-center text-xs font-semibold">{crest}</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{name}</div>
                          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                            {p.handicap_index != null && <span>HCP {p.handicap_index}</span>}
                            {p.clubs.length > 0 && (
                              <>
                                {p.handicap_index != null && <span className="text-[var(--border)]">&middot;</span>}
                                <span className="truncate">{p.clubs.join(", ")}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filtered.length > 50 && (
                  <div className="p-2 text-center text-xs text-[var(--muted)]">
                    Showing first 50 of {filtered.length}. Narrow your search.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
