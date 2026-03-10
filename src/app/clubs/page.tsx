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

type Tab = "my" | "ct" | "all";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function normalizeClubRow(row: any): ClubRow | null {
  if (!row) return null;
  const id = String(row.id ?? "");
  const name = String(row.name ?? row.club_name ?? "");
  if (!id || !name) return null;

  return {
    id,
    name,
    city: row.city ?? row.town ?? row.location ?? null,
    state: row.state ?? null,
    logo_url: row.logo_url ?? null,
  };
}

function dedupeByName(list: ClubRow[]) {
  const seen = new Set<string>();
  const out: ClubRow[] = [];

  for (const c of list) {
    const k = c.name.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }

  return out;
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
        active
          ? "bg-[var(--pine)] text-white shadow-sm"
          : "bg-white/80 text-[var(--ink)] hover:bg-white hover:shadow-sm border border-transparent hover:border-[var(--border)]"
      )}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--pine)]/10 px-2.5 py-1 text-xs font-medium text-[var(--pine)]">
      {children}
    </span>
  );
}

export default function ClubsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("my");
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
  const [newLogoUrl, setNewLogoUrl] = useState("");

  async function refresh(sessionUser?: { id: string; email?: string | null }) {
    try {
      setLoading(true);
      setStatus(null);

      // When called from onAuthStateChange we get sessionUser; when called after
      // an action the user is already set in state — read it from meId.
      const uid = sessionUser?.id ?? meId;
      const uemail = sessionUser?.email ?? meEmail;
      if (!uid) { setLoading(false); return; }

      if (sessionUser) {
        setMeId(uid);
        setMeEmail(uemail ?? null);
      }

      // memberships (my clubs) with guest_fee
      const mem = await supabase
        .from("club_memberships")
        .select("club_id, guest_fee")
        .eq("user_id", uid);

      if (!mem.error && Array.isArray(mem.data)) {
        setMyClubIds(new Set(mem.data.map((r: any) => String(r.club_id))));
        const fees: Record<string, number | null> = {};
        for (const r of mem.data as any[]) {
          fees[String(r.club_id)] = r.guest_fee ?? null;
        }
        setMyClubFees(fees);
      } else if (mem.error) {
        setStatus(mem.error.message);
      }

      // clubs directory
      const clubsRes = await supabase
        .from("clubs")
        .select("id, name, city, state, logo_url")
        .order("name", { ascending: true })
        .limit(1200);

      if (clubsRes.error) {
        setStatus(clubsRes.error.message);
        setDbClubs([]);
        setLoading(false);
        return;
      }

      const rows = (clubsRes.data ?? [])
        .map(normalizeClubRow)
        .filter(Boolean) as ClubRow[];

      setDbClubs(rows);
      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to load clubs");
      setLoading(false);
    }
  }

  useEffect(() => {
    let handled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      if (session?.user) {
        refresh(session.user);
      } else {
        setMeId(null);
        setMeEmail(null);
        setMyClubIds(new Set());
        setDbClubs([]);
        setLoading(false);
      }
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && session?.user) {
        refresh(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const ctDirectory = useMemo(() => {
    const ctFromDb = dbClubs.filter(
      (c) => String(c.state ?? "").toUpperCase() === "CT"
    );

    const ctFromList: ClubRow[] = CT_CLUBS.map((name) => ({
      id: `ct::${name}`,
      name,
      city: null,
      state: "CT",
      logo_url: null,
    }));

    return dedupeByName([...ctFromDb, ...ctFromList]).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [dbClubs]);

  const myClubs = useMemo(
    () => dbClubs.filter((c) => myClubIds.has(c.id)),
    [dbClubs, myClubIds]
  );

  const activeList = useMemo(() => {
    if (tab === "my") return myClubs;
    if (tab === "ct") return ctDirectory;
    return dbClubs;
  }, [tab, myClubs, ctDirectory, dbClubs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeList;

    return activeList.filter((c) => {
      const name = c.name.toLowerCase();
      const loc = `${c.city ?? ""} ${c.state ?? ""}`.toLowerCase();
      return name.includes(q) || loc.includes(q);
    });
  }, [activeList, query]);

  async function ensureClubId(club: ClubRow): Promise<string | null> {
    if (!club.id.startsWith("ct::")) return club.id;

    const { data, error } = await supabase
      .from("clubs")
      .insert({
        name: club.name,
        city: club.city,
        state: club.state ?? "CT",
        logo_url: club.logo_url,
      })
      .select("id")
      .single();

    if (error) {
      setStatus(error.message);
      return null;
    }

    return data.id as string;
  }

  async function updateGuestFee(clubId: string, fee: number | null) {
    if (!meId) return;
    const { error } = await supabase
      .from("club_memberships")
      .update({ guest_fee: fee })
      .eq("user_id", meId)
      .eq("club_id", clubId);

    if (error) {
      setStatus(error.message);
      return;
    }
    setMyClubFees((prev) => ({ ...prev, [clubId]: fee }));
  }

  async function ensureProfile(userId: string, email: string | null) {
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, email: email }, { onConflict: "id" });
    if (error) console.warn("ensureProfile:", error.message);
  }

  async function addToMyClubs(club: ClubRow) {
    if (!meId) {
      setStatus("Auth session missing");
      return;
    }

    // Ensure profile row exists (FK constraint requires it)
    await ensureProfile(meId, meEmail);

    const realId = await ensureClubId(club);
    if (!realId) return;

    const res = await supabase
      .from("club_memberships")
      .insert({ user_id: meId, club_id: realId });

    if (res.error) {
      setStatus(res.error.message);
      return;
    }

    setStatus("Added to My Clubs.");
    await refresh();
    setTab("my");
  }

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    const name = newName.trim();
    if (!name) {
      setStatus("Enter a club name.");
      return;
    }

    const { data, error } = await supabase
      .from("clubs")
      .insert({
        name,
        city: newCity.trim() || null,
        state: newState.trim() || null,
        logo_url: newLogoUrl.trim() || null,
      })
      .select("id")
      .single();

    if (error) {
      setStatus(error.message);
      return;
    }

    if (meId) {
      await ensureProfile(meId, meEmail);
      await supabase
        .from("club_memberships")
        .insert({ user_id: meId, club_id: data.id });
    }

    setShowAdd(false);
    setNewName("");
    setNewCity("");
    setNewState("CT");
    setNewLogoUrl("");

    await refresh();
    setTab("my");
    setStatus("Club created.");
  }

  const headline = useMemo(() => {
    if (tab === "my") return "My clubs";
    if (tab === "ct") return "Connecticut directory";
    return "All clubs";
  }, [tab]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Clubs</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              <span>{headline}</span>
              <span className="text-[var(--border)]">&middot;</span>
              <span>
                Showing{" "}
                <span className="font-semibold text-[var(--ink)]">
                  {filtered.length}
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/matches/new"
              className="rounded-full bg-[var(--pine)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[1px]"
            >
              New match
            </Link>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="rounded-full border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-white hover:shadow-sm"
            >
              Add club
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 rounded-full bg-black/[0.04] p-1">
            <TabButton active={tab === "my"} onClick={() => setTab("my")}>
              My clubs
            </TabButton>
            <TabButton active={tab === "ct"} onClick={() => setTab("ct")}>
              CT directory
            </TabButton>
            <TabButton active={tab === "all"} onClick={() => setTab("all")}>
              All
            </TabButton>

            {tab !== "my" && <Badge>Browse</Badge>}
          </div>

          <div className="relative">
            <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              className="w-full sm:w-[360px] rounded-full border border-[var(--border)] bg-white/80 pl-10 pr-4 py-2.5 text-sm outline-none transition-all duration-200 focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
              placeholder="Search by club or town..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-[var(--muted)]">Loading...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04]">
              <svg className="h-5 w-5 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-[var(--ink)]">No clubs found</div>
            <div className="mt-1 text-sm text-[var(--muted)]">
              Try a different search, or switch tabs.
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((c) => {
              const isMember = !c.id.startsWith("ct::") && myClubIds.has(c.id);
              const crest = initials(c.name);
              const loc = [c.city, c.state].filter(Boolean).join(", ");

              const hasProfile = !c.id.startsWith("ct::");

              return (
                <div
                  key={c.id}
                  onClick={() => { if (hasProfile) router.push(`/clubs/${c.id}`); }}
                  className={cx(
                    "group rounded-xl border border-[var(--border)] bg-white/70 p-4 transition-all duration-200 hover:bg-white hover:shadow-sm",
                    hasProfile && "cursor-pointer"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm">
                        {c.logo_url ? (
                          <img
                            src={c.logo_url}
                            alt={`${c.name} logo`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-xs font-semibold">
                            {crest}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className={cx("truncate text-sm font-semibold text-[var(--ink)]", hasProfile && "group-hover:text-[var(--pine)] transition-colors")}>
                          {c.name}
                        </div>
                        <div className="truncate text-xs text-[var(--muted)]">
                          {loc || (tab === "ct" ? "Connecticut" : "\u2014")}
                        </div>
                        {isMember && (
                          <div className="mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] font-medium text-[var(--muted)]">Guest fee:</span>
                            {editingFeeClub === c.id ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                autoFocus
                                className="w-16 rounded-md border border-[var(--pine)]/40 bg-white px-1.5 py-0.5 text-[11px] outline-none"
                                placeholder="$0"
                                value={myClubFees[c.id] != null ? `$${myClubFees[c.id]}` : ""}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^0-9.]/g, "");
                                  const num = parseFloat(raw);
                                  if (raw === "" || raw === ".") {
                                    setMyClubFees((prev) => ({ ...prev, [c.id]: null }));
                                  } else if (!isNaN(num)) {
                                    setMyClubFees((prev) => ({ ...prev, [c.id]: num }));
                                  }
                                }}
                                onBlur={() => {
                                  updateGuestFee(c.id, myClubFees[c.id] ?? null);
                                  setEditingFeeClub(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    updateGuestFee(c.id, myClubFees[c.id] ?? null);
                                    setEditingFeeClub(null);
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditingFeeClub(c.id)}
                                className="rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink)] transition hover:border-[var(--border)] hover:bg-white/80"
                              >
                                {myClubFees[c.id] != null ? `$${myClubFees[c.id]}` : "Set"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className={cx(
                        "flex items-center gap-2 transition-all duration-200",
                        "md:opacity-0 md:group-hover:opacity-100"
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        href={`/matches/new?course=${encodeURIComponent(c.name)}`}
                        className="rounded-full border border-[var(--border)] bg-white/80 px-3.5 py-1.5 text-xs font-medium transition-all duration-200 hover:bg-white hover:shadow-sm"
                      >
                        Create
                      </Link>

                      {!isMember && (
                        <button
                          type="button"
                          onClick={() => addToMyClubs(c)}
                          className="rounded-full bg-[var(--pine)] px-3.5 py-1.5 text-xs font-medium text-white transition-all duration-200 hover:shadow-sm hover:-translate-y-[0.5px]"
                        >
                          Add
                        </button>
                      )}

                      {isMember && <Badge>Member</Badge>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {status && (
        <div className="rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm text-[var(--ink)] shadow-sm">
          {status}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold tracking-tight">Add a club</div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors duration-200 hover:bg-black/5 hover:text-[var(--ink)]"
                onClick={() => setShowAdd(false)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={createClub} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium tracking-wide text-[var(--muted)]">Club name</label>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm outline-none transition-all duration-200 focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., TPC River Highlands"
                  list="ct-clubs"
                  required
                />
                <datalist id="ct-clubs">
                  {CT_CLUBS.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium tracking-wide text-[var(--muted)]">City / Town</label>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm outline-none transition-all duration-200 focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder="Cromwell"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium tracking-wide text-[var(--muted)]">State</label>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm outline-none transition-all duration-200 focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                    value={newState}
                    onChange={(e) => setNewState(e.target.value)}
                    placeholder="CT"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium tracking-wide text-[var(--muted)]">Logo URL (optional)</label>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm outline-none transition-all duration-200 focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                  value={newLogoUrl}
                  onChange={(e) => setNewLogoUrl(e.target.value)}
                  placeholder="https://...logo.png"
                />
                <div className="text-xs text-[var(--muted)]">
                  Next step: we'll replace this with a real upload to Supabase
                  Storage.
                </div>
              </div>

              <button className="rounded-full bg-[var(--pine)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[1px]">
                Create club
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
