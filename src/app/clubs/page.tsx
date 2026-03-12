"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";

import { initials } from "@/lib/utils";

type ApiCourse = {
  id: number;
  club_name: string;
  city: string | null;
  state: string | null;
  access_type: string | null;
  courses?: { courseID: string; courseName: string; numHoles?: number }[];
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

  // Private/public confirmation step
  const [pendingClub, setPendingClub] = useState<{ name: string; city?: string | null; state?: string | null; accessType?: string | null } | null>(null);

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

  async function addClub(clubName: string, city?: string | null, state?: string | null, isPrivate?: boolean) {
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
      const insertData: Record<string, any> = { name: clubName.trim() };
      if (city) insertData.city = city;
      if (state) insertData.state = state;
      if (isPrivate != null) insertData.is_private = isPrivate;
      const { data, error } = await supabase
        .from("clubs")
        .insert(insertData)
        .select("id")
        .single();
      if (error) { setStatus(error.message); return; }
      clubId = data.id;
    } else {
      // Update existing club with city/state/is_private if we have it
      const updates: Record<string, any> = {};
      if (city) updates.city = city;
      if (state) updates.state = state;
      if (isPrivate != null) updates.is_private = isPrivate;
      if (Object.keys(updates).length > 0) {
        await supabase.from("clubs").update(updates).eq("id", clubId);
      }
    }

    const { error } = await supabase.from("club_memberships").insert({ user_id: meId, club_id: clubId });
    if (error) {
      if (error.message.includes("duplicate")) setStatus("You're already a member of this club.");
      else setStatus(error.message);
      return;
    }

    setPendingClub(null);
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

  const ctSuggestions: string[] = [];

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
          <div>{status}</div>
          <button
            type="button"
            onClick={() => { setStatus(null); refresh(); }}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-black/[0.03]" />
          <div className="h-24 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
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
                className="rounded-2xl border border-[var(--border)] bg-white/60 p-5 cursor-pointer transition hover:border-[var(--pine)]/20 hover:shadow-sm"
                onClick={() => router.push(`/clubs/${c.id}`)}
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
                <div className="mt-3 flex items-center justify-between border-t border-[var(--border)]/50 pt-3" onClick={(e) => e.stopPropagation()}>
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) { setShowAdd(false); setAddQuery(""); setApiResults([]); setPendingClub(null); } }}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] shadow-2xl overflow-hidden">
            <div className="bg-red-50 border-b border-red-200/60 px-5 py-3">
              <div className="flex items-start gap-2.5">
                <svg className="h-5 w-5 flex-shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <p className="text-[13px] text-red-800 leading-snug">
                  <span className="font-bold">Only add clubs you are a member of.</span> Memberships are verified — fraudulent claims will result in a ban.
                </p>
              </div>
            </div>

            <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold">{pendingClub ? "Club type" : "Add a club"}</div>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-black/5"
                onClick={() => { setShowAdd(false); setAddQuery(""); setApiResults([]); setPendingClub(null); }}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {pendingClub ? (
              /* Step 2: Private / Public selection */
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
                  <div className="text-sm font-semibold text-[var(--ink)]">{pendingClub.name}</div>
                  {(pendingClub.city || pendingClub.state) && (
                    <div className="text-xs text-[var(--muted)]">{[pendingClub.city, pendingClub.state].filter(Boolean).join(", ")}</div>
                  )}
                </div>

                <div className="text-sm text-[var(--muted)]">Is this a private or public club?</div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => addClub(pendingClub.name, pendingClub.city, pendingClub.state, true)}
                    className="flex flex-col items-center gap-2 rounded-xl border-2 border-[var(--border)] bg-white px-4 py-4 transition hover:border-[var(--pine)] hover:bg-[var(--pine)]/5"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                    <span className="text-sm font-semibold text-[var(--ink)]">Private</span>
                    <span className="text-[10px] text-[var(--muted)] text-center leading-tight">Members only — guests need a member host</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => addClub(pendingClub.name, pendingClub.city, pendingClub.state, false)}
                    className="flex flex-col items-center gap-2 rounded-xl border-2 border-[var(--border)] bg-white px-4 py-4 transition hover:border-[var(--pine)] hover:bg-[var(--pine)]/5"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                      <circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/>
                    </svg>
                    <span className="text-sm font-semibold text-[var(--ink)]">Public</span>
                    <span className="text-[10px] text-[var(--muted)] text-center leading-tight">Open to anyone — no membership required to play</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setPendingClub(null)}
                  className="w-full text-center text-xs text-[var(--muted)] transition hover:text-[var(--ink)]"
                >
                  &larr; Back to search
                </button>
              </div>
            ) : (
              /* Step 1: Search */
              <>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
              value={addQuery}
              onChange={(e) => { setAddQuery(e.target.value); searchApi(e.target.value); }}
              placeholder="Search golf clubs..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && addQuery.trim()) setPendingClub({ name: addQuery.trim() });
              }}
            />

            <div className="mt-3 max-h-[280px] overflow-auto space-y-1">
              {/* CT clubs — instant */}
              {ctSuggestions.map((name) => (
                <button
                  key={`ct-${name}`}
                  type="button"
                  onClick={() => setPendingClub({ name, state: "CT" })}
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
                  const isPrivateFromApi = c.access_type?.toLowerCase() === "private" || c.access_type?.toLowerCase() === "privé";
                  return (
                    <button
                      key={`api-${c.id}`}
                      type="button"
                      onClick={() => setPendingClub({ name: c.club_name, city: c.city, state: c.state, accessType: c.access_type })}
                      className="w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--pine)]/5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{c.club_name}</span>
                        {isPrivateFromApi && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                          </svg>
                        )}
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {loc}{loc && c.access_type ? " · " : ""}{c.access_type ?? ""}
                      </div>
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
                  onClick={() => setPendingClub({ name: addQuery.trim() })}
                  className="w-full rounded-lg bg-[var(--pine)]/5 px-3 py-2.5 text-left text-sm font-medium text-[var(--pine)] transition hover:bg-[var(--pine)]/10"
                >
                  Add &ldquo;{addQuery.trim()}&rdquo; manually
                </button>
              )}
            </div>
              </>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
