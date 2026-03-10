"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { CT_CLUBS } from "@/lib/data/ctClubs";

type ClubRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  logo_url: string | null;
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function normalizeClubRow(row: any): ClubRow | null {
  if (!row) return null;
  const id = String(row.id ?? "");
  const name = String(row.name ?? row.club_name ?? "");
  if (!id || !name) return null;
  return { id, name, city: row.city ?? null, state: row.state ?? null, logo_url: row.logo_url ?? null };
}

export default function ClubsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [dbClubs, setDbClubs] = useState<ClubRow[]>([]);
  const [myClubIds, setMyClubIds] = useState<Set<string>>(new Set());
  const [myClubFees, setMyClubFees] = useState<Record<string, number | null>>({});
  const [editingFeeClub, setEditingFeeClub] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("CT");

  async function refresh(sessionUser?: { id: string; email?: string | null }) {
    try {
      setLoading(true);
      setStatus(null);
      const uid = sessionUser?.id ?? meId;
      const uemail = sessionUser?.email ?? meEmail;
      if (!uid) { setLoading(false); return; }

      if (sessionUser) { setMeId(uid); setMeEmail(uemail ?? null); }

      const mem = await supabase
        .from("club_memberships")
        .select("club_id, guest_fee")
        .eq("user_id", uid);

      if (!mem.error && Array.isArray(mem.data)) {
        setMyClubIds(new Set(mem.data.map((r: any) => String(r.club_id))));
        const fees: Record<string, number | null> = {};
        for (const r of mem.data as any[]) fees[String(r.club_id)] = r.guest_fee ?? null;
        setMyClubFees(fees);
      }

      const clubsRes = await supabase
        .from("clubs")
        .select("id, name, city, state, logo_url")
        .order("name", { ascending: true })
        .limit(1200);

      if (clubsRes.error) { setStatus(clubsRes.error.message); setDbClubs([]); }
      else setDbClubs((clubsRes.data ?? []).map(normalizeClubRow).filter(Boolean) as ClubRow[]);

      setLoading(false);
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to load");
      setLoading(false);
    }
  }

  useEffect(() => {
    let handled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      if (session?.user) refresh(session.user);
      else { setMeId(null); setLoading(false); }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && session?.user) refresh(session.user);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myClubs = useMemo(() => dbClubs.filter((c) => myClubIds.has(c.id)), [dbClubs, myClubIds]);
  const browseClubs = useMemo(() => dbClubs.filter((c) => !myClubIds.has(c.id)), [dbClubs, myClubIds]);

  const filteredBrowse = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return browseClubs;
    return browseClubs.filter((c) => {
      const name = c.name.toLowerCase();
      const loc = `${c.city ?? ""} ${c.state ?? ""}`.toLowerCase();
      return name.includes(q) || loc.includes(q);
    });
  }, [browseClubs, query]);

  async function ensureProfile(userId: string, email: string | null) {
    await supabase.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });
  }

  async function ensureClubId(club: ClubRow): Promise<string | null> {
    if (!club.id.startsWith("ct::")) return club.id;
    const { data, error } = await supabase
      .from("clubs")
      .insert({ name: club.name, city: club.city, state: club.state ?? "CT", logo_url: null })
      .select("id")
      .single();
    if (error) { setStatus(error.message); return null; }
    return data.id as string;
  }

  async function addToMyClubs(club: ClubRow) {
    if (!meId) return;
    await ensureProfile(meId, meEmail);
    const realId = await ensureClubId(club);
    if (!realId) return;
    const { error } = await supabase.from("club_memberships").insert({ user_id: meId, club_id: realId });
    if (error) { setStatus(error.message); return; }
    await refresh();
  }

  async function removeFromMyClubs(clubId: string) {
    if (!meId) return;
    const { error } = await supabase.from("club_memberships").delete().eq("user_id", meId).eq("club_id", clubId);
    if (error) { setStatus(error.message); return; }
    await refresh();
  }

  async function updateGuestFee(clubId: string, fee: number | null) {
    if (!meId) return;
    const { error } = await supabase.from("club_memberships").update({ guest_fee: fee }).eq("user_id", meId).eq("club_id", clubId);
    if (error) { setStatus(error.message); return; }
    setMyClubFees((prev) => ({ ...prev, [clubId]: fee }));
  }

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) { setStatus("Enter a club name."); return; }

    const { data, error } = await supabase
      .from("clubs")
      .insert({ name, city: newCity.trim() || null, state: newState.trim() || null, logo_url: null })
      .select("id")
      .single();
    if (error) { setStatus(error.message); return; }

    if (meId) {
      await ensureProfile(meId, meEmail);
      await supabase.from("club_memberships").insert({ user_id: meId, club_id: data.id });
    }
    setShowAdd(false);
    setNewName("");
    setNewCity("");
    setNewState("CT");
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memberships</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage your club memberships and guest fees.
        </p>
      </div>

      {status && (
        <div className="rounded-xl bg-emerald-50/50 border border-emerald-200/60 px-4 py-3 text-sm text-emerald-800">
          {status}
        </div>
      )}

      {/* My clubs */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">My clubs</h2>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-lg border border-[var(--border)] bg-white/80 px-3 py-1.5 text-xs font-medium transition hover:bg-white hover:shadow-sm"
          >
            Add club
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="h-16 rounded-xl bg-black/[0.03]" />
            <div className="h-16 rounded-xl bg-black/[0.03]" />
          </div>
        ) : myClubs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-white/60 p-6 text-center text-sm text-[var(--muted)]">
            No memberships yet. Browse clubs below or add one.
          </div>
        ) : (
          <div className="space-y-2">
            {myClubs.map((c) => {
              const loc = [c.city, c.state].filter(Boolean).join(", ");
              return (
                <div
                  key={c.id}
                  onClick={() => router.push(`/clubs/${c.id}`)}
                  className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 p-4 transition cursor-pointer hover:border-[var(--pine)]/20 hover:shadow-sm"
                >
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt={c.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-xs font-semibold">{initials(c.name)}</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--pine)] transition-colors">{c.name}</div>
                    <div className="text-xs text-[var(--muted)]">{loc || "—"}</div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[var(--muted)]">Guest fee:</span>
                      {editingFeeClub === c.id ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          className="w-14 rounded-md border border-[var(--pine)]/40 bg-white px-1.5 py-0.5 text-[11px] outline-none"
                          placeholder="$0"
                          defaultValue={myClubFees[c.id] != null ? String(myClubFees[c.id]) : ""}
                          onBlur={(e) => {
                            const num = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                            updateGuestFee(c.id, isNaN(num) ? null : num);
                            setEditingFeeClub(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingFeeClub(c.id)}
                          className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-black/5"
                        >
                          {myClubFees[c.id] != null ? `$${myClubFees[c.id]}` : "Set"}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { if (confirm(`Remove ${c.name} from your clubs?`)) removeFromMyClubs(c.id); }}
                      className="rounded-md p-1 text-[var(--muted)] transition hover:bg-red-50 hover:text-red-500"
                      title="Remove"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Browse clubs */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Browse clubs</h2>
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            className="w-full rounded-xl border border-[var(--border)] bg-white/60 pl-9 pr-4 py-2.5 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
            placeholder="Search by name or location..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {!loading && filteredBrowse.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4 text-center text-sm text-[var(--muted)]">
            No clubs found. Try a different search or add one.
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredBrowse.slice(0, 30).map((c) => {
              const loc = [c.city, c.state].filter(Boolean).join(", ");
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-lg bg-white/40 px-3 py-2.5 transition hover:bg-white/80"
                >
                  <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)]/80 text-white">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt={c.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-[10px] font-semibold">{initials(c.name)}</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    {loc && <div className="text-xs text-[var(--muted)]">{loc}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => addToMyClubs(c)}
                    className="flex-shrink-0 rounded-lg bg-[var(--pine)] px-3 py-1.5 text-xs font-medium text-white transition hover:shadow-sm"
                  >
                    Join
                  </button>
                </div>
              );
            })}
            {filteredBrowse.length > 30 && (
              <div className="text-center text-xs text-[var(--muted)] py-2">
                Showing 30 of {filteredBrowse.length}. Narrow your search.
              </div>
            )}
          </div>
        )}
      </section>

      {/* Add club modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold">Add a club</div>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-black/5"
                onClick={() => setShowAdd(false)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={createClub} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium tracking-[0.15em] text-[var(--muted)]">CLUB NAME</label>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., TPC River Highlands"
                  list="ct-clubs"
                  required
                />
                <datalist id="ct-clubs">
                  {CT_CLUBS.map((n) => <option key={n} value={n} />)}
                </datalist>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium tracking-[0.15em] text-[var(--muted)]">CITY</label>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder="Cromwell"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium tracking-[0.15em] text-[var(--muted)]">STATE</label>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
                    value={newState}
                    onChange={(e) => setNewState(e.target.value)}
                    placeholder="CT"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)]"
              >
                Create club
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
