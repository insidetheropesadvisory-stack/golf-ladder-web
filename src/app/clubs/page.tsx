"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { CT_CLUBS } from "@/lib/data/ctClubs";
import { initials } from "@/lib/utils";

type ApiCourse = {
  id: number;
  club_name: string;
  city: string | null;
  state: string | null;
};

type ClubRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  logo_url: string | null;
};

export default function ClubsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [myClubs, setMyClubs] = useState<ClubRow[]>([]);
  const [myClubFees, setMyClubFees] = useState<Record<string, number | null>>({});
  const [editingFeeClub, setEditingFeeClub] = useState<string | null>(null);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [apiResults, setApiResults] = useState<ApiCourse[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh(sessionUser?: { id: string; email?: string | null }) {
    try {
      setLoading(true);
      const uid = sessionUser?.id ?? meId;
      if (!uid) { setLoading(false); return; }
      if (sessionUser) { setMeId(uid); setMeEmail(sessionUser.email ?? null); }

      // Fetch my memberships with club details
      const { data: memberships, error: memErr } = await supabase
        .from("club_memberships")
        .select("club_id, guest_fee, clubs(id, name, city, state, logo_url)")
        .eq("user_id", uid);

      if (memErr) { setStatus(memErr.message); setLoading(false); return; }

      const clubs: ClubRow[] = [];
      const fees: Record<string, number | null> = {};
      const clubIds: string[] = [];

      for (const m of (memberships ?? []) as any[]) {
        const c = m.clubs;
        if (!c?.id) continue;
        clubs.push({ id: c.id, name: c.name, city: c.city, state: c.state, logo_url: c.logo_url });
        fees[c.id] = m.guest_fee ?? null;
        clubIds.push(c.id);
      }

      setMyClubs(clubs.sort((a, b) => a.name.localeCompare(b.name)));
      setMyClubFees(fees);

      // Fetch member counts for my clubs
      if (clubIds.length > 0) {
        const { data: counts } = await supabase
          .from("club_memberships")
          .select("club_id")
          .in("club_id", clubIds);

        if (counts) {
          const countMap: Record<string, number> = {};
          for (const r of counts as any[]) {
            const cid = String(r.club_id);
            countMap[cid] = (countMap[cid] ?? 0) + 1;
          }
          setMemberCounts(countMap);
        }
      }

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

  async function ensureProfile(userId: string, email: string | null) {
    await supabase.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });
  }

  async function addClub(clubName: string) {
    if (!meId) return;
    setStatus(null);
    await ensureProfile(meId, meEmail);

    // Check if club exists
    const { data: existing } = await supabase
      .from("clubs")
      .select("id")
      .ilike("name", clubName.trim())
      .maybeSingle();

    let clubId = existing?.id;

    if (!clubId) {
      const { data, error } = await supabase
        .from("clubs")
        .insert({ name: clubName.trim(), state: "CT" })
        .select("id")
        .single();
      if (error) { setStatus(error.message); return; }
      clubId = data.id;
    }

    const { error } = await supabase.from("club_memberships").insert({ user_id: meId, club_id: clubId });
    if (error) {
      if (error.message.includes("duplicate")) setStatus("You're already a member of this club.");
      else setStatus(error.message);
      return;
    }

    setShowAdd(false);
    setAddQuery("");
    await refresh();
  }

  async function removeClub(clubId: string) {
    if (!meId) return;
    setStatus(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/club-membership", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ clubId }),
      });
      const json = await res.json();
      if (!res.ok) { setStatus(json.error ?? "Failed to remove"); return; }
      await refresh();
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to remove");
    }
  }

  async function updateGuestFee(clubId: string, fee: number | null) {
    if (!meId) return;
    await supabase.from("club_memberships").update({ guest_fee: fee }).eq("user_id", meId).eq("club_id", clubId);
    setMyClubFees((prev) => ({ ...prev, [clubId]: fee }));
  }

  const ctSuggestions = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const myNames = new Set(myClubs.map((c) => c.name.toLowerCase()));
    return CT_CLUBS.filter(
      (name) => name.toLowerCase().includes(q) && !myNames.has(name.toLowerCase())
    ).slice(0, 8);
  }, [addQuery, myClubs]);

  function searchApi(q: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) { setApiResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/golf-courses?q=${encodeURIComponent(trimmed)}&limit=8`);
        const json = await res.json();
        setApiResults(json.courses ?? []);
      } catch { setApiResults([]); }
      setSearching(false);
    }, 400);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memberships</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Your club memberships and guest fees.
        </p>
      </div>

      {status && (
        <div className="rounded-xl bg-amber-50/50 border border-amber-200/60 px-4 py-3 text-sm text-amber-800">
          {status}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 rounded-2xl bg-black/[0.03]" />
          <div className="h-24 rounded-2xl bg-black/[0.03]" />
        </div>
      ) : myClubs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
          <div className="text-sm font-semibold text-[var(--ink)]">No memberships yet</div>
          <p className="mt-1 text-sm text-[var(--muted)]">Add the clubs you belong to.</p>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="mt-4 rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)]"
          >
            Add a club
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {myClubs.map((c) => {
            const loc = [c.city, c.state].filter(Boolean).join(", ");
            const count = memberCounts[c.id] ?? 0;

            return (
              <div
                key={c.id}
                className="rounded-2xl border border-[var(--border)] bg-white/60 p-5"
              >
                <div className="flex items-center gap-4">
                  <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-[var(--pine)] text-white shadow-sm">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt={c.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-sm font-semibold">{initials(c.name)}</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-[var(--ink)]">
                      {c.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                      {loc && <span>{loc}</span>}
                      {loc && count > 0 && <span className="text-[var(--border)]">&middot;</span>}
                      {count > 0 && <span>{count} member{count !== 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                </div>

                {/* Guest fee & remove */}
                <div className="mt-3 flex items-center justify-between border-t border-[var(--border)]/50 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--muted)]">Guest fee</span>
                    {editingFeeClub === c.id ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        className="w-16 rounded-lg border border-[var(--pine)]/40 bg-white px-2 py-1 text-xs outline-none"
                        placeholder="$0"
                        defaultValue={myClubFees[c.id] != null ? String(myClubFees[c.id]) : ""}
                        onBlur={(e) => {
                          const num = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                          updateGuestFee(c.id, isNaN(num) ? null : num);
                          setEditingFeeClub(null);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingFeeClub(c.id)}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--ink)] transition hover:bg-black/5"
                      >
                        {myClubFees[c.id] != null ? `$${myClubFees[c.id]}` : "Not set"}
                      </button>
                    )}
                  </div>
                  {confirmRemove === c.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setConfirmRemove(null); removeClub(c.id); }}
                        className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-600"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(null)}
                        className="text-xs text-[var(--muted)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(c.id)}
                      className="text-xs text-[var(--muted)] transition hover:text-red-500"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="w-full rounded-xl border border-dashed border-[var(--border)] bg-white/40 py-3 text-sm font-medium text-[var(--muted)] transition hover:border-[var(--pine)]/30 hover:text-[var(--pine)]"
          >
            + Add another club
          </button>
        </div>
      )}

      {/* Add club modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) { setShowAdd(false); setAddQuery(""); setApiResults([]); } }}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold">Add a club</div>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-black/5"
                onClick={() => { setShowAdd(false); setAddQuery(""); setApiResults([]); }}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <input
              className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
              value={addQuery}
              onChange={(e) => { setAddQuery(e.target.value); searchApi(e.target.value); }}
              placeholder="Search golf clubs..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && addQuery.trim()) addClub(addQuery);
              }}
            />

            <div className="mt-3 max-h-[280px] overflow-auto space-y-1">
              {/* CT clubs — instant */}
              {ctSuggestions.map((name) => (
                <button
                  key={`ct-${name}`}
                  type="button"
                  onClick={() => addClub(name)}
                  className="w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--pine)]/5"
                >
                  <div className="text-sm font-medium">{name}</div>
                  <div className="text-xs text-[var(--muted)]">Connecticut</div>
                </button>
              ))}

              {/* API results — after debounce */}
              {ctSuggestions.length > 0 && apiResults.length > 0 && (
                <div className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wider text-[var(--muted)] uppercase">Other courses</div>
              )}
              {apiResults
                .filter((c) => !ctSuggestions.some((ct) => ct.toLowerCase() === c.club_name.toLowerCase()))
                .map((c) => {
                  const loc = [c.city, c.state].filter(Boolean).join(", ");
                  return (
                    <button
                      key={`api-${c.id}`}
                      type="button"
                      onClick={() => addClub(c.club_name)}
                      className="w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--pine)]/5"
                    >
                      <div className="text-sm font-medium">{c.club_name}</div>
                      {loc && <div className="text-xs text-[var(--muted)]">{loc}</div>}
                    </button>
                  );
                })}

              {searching && (
                <div className="px-3 py-2.5 text-xs text-[var(--muted)]">Searching nationwide...</div>
              )}

              {addQuery.trim().length >= 2 && ctSuggestions.length === 0 && !searching && apiResults.length === 0 && (
                <div className="px-3 py-2.5 text-xs text-[var(--muted)]">No matching clubs found.</div>
              )}

              {addQuery.trim() && (
                <button
                  type="button"
                  onClick={() => addClub(addQuery)}
                  className="w-full rounded-lg bg-[var(--pine)]/5 px-3 py-2.5 text-left text-sm font-medium text-[var(--pine)] transition hover:bg-[var(--pine)]/10"
                >
                  Add &ldquo;{addQuery.trim()}&rdquo; manually
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
