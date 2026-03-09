"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
        "rounded-xl border px-3 py-2 text-sm font-semibold transition",
        active
          ? "bg-emerald-950 text-white border-emerald-950"
          : "bg-white/60 hover:bg-white border-black/10"
      )}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-xs font-medium text-black/70">
      {children}
    </span>
  );
}

function TopoPattern() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.05]" aria-hidden="true">
      <defs>
        <pattern id="topo" width="180" height="180" patternUnits="userSpaceOnUse">
          <path
            d="M10,35 C55,10 90,10 135,35 C160,50 175,52 200,35"
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
          <path
            d="M-15,80 C25,55 70,60 110,85 C145,105 175,105 215,80"
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
          <path
            d="M10,125 C55,100 95,108 130,133 C155,150 175,150 205,125"
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
          <circle cx="120" cy="50" r="2" fill="black" />
          <circle cx="60" cy="100" r="2" fill="black" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#topo)" />
    </svg>
  );
}

export default function ClubsPage() {
  const [tab, setTab] = useState<Tab>("my");
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const [dbClubs, setDbClubs] = useState<ClubRow[]>([]);
  const [myClubIds, setMyClubIds] = useState<Set<string>>(new Set());

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

      // memberships (my clubs)
      const mem = await supabase
        .from("club_memberships")
        .select("club_id")
        .eq("user_id", uid);

      if (!mem.error && Array.isArray(mem.data)) {
        setMyClubIds(new Set(mem.data.map((r: any) => String(r.club_id))));
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

  async function addToMyClubs(club: ClubRow) {
    if (!meId) {
      setStatus("Auth session missing");
      return;
    }

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
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="relative overflow-hidden rounded-3xl border bg-white/65 backdrop-blur">
          <TopoPattern />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-medium tracking-widest text-black/55">
                  RECIPROCITY
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Clubs</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-black/60">
                  <span>{headline}</span>
                  <span className="text-black/30">•</span>
                  <span>
                    Showing{" "}
                    <span className="font-semibold text-black/70">
                      {filtered.length}
                    </span>
                  </span>
                  {meEmail && (
                    <>
                      <span className="text-black/30">•</span>
                      <span className="text-xs">
                        Signed in as{" "}
                        <span className="font-semibold text-black/70">
                          {meEmail}
                        </span>
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href="/matches/new"
                  className="rounded-xl border bg-emerald-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
                >
                  New match
                </Link>
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="rounded-xl border bg-white/70 px-3 py-2 text-sm font-semibold hover:bg-white"
                >
                  Add club
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
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

              <input
                className="w-full sm:w-[360px] rounded-2xl border bg-white/70 px-3 py-2 text-sm outline-none focus:bg-white"
                placeholder="Search by club or town…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border bg-white/65 p-4 sm:p-5 backdrop-blur">
          {loading ? (
            <div className="p-6 text-sm text-black/60">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <div className="text-sm font-semibold">No results</div>
              <div className="mt-1 text-sm text-black/60">
                Try a different search, or switch tabs.
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((c) => {
                const isMember = !c.id.startsWith("ct::") && myClubIds.has(c.id);
                const crest = initials(c.name);
                const loc = [c.city, c.state].filter(Boolean).join(", ");

                return (
                  <div
                    key={c.id}
                    className="group rounded-2xl border bg-white/80 p-4 hover:shadow-sm transition"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative h-10 w-10 overflow-hidden rounded-xl border bg-emerald-950 text-white">
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
                          <div className="truncate text-sm font-semibold">{c.name}</div>
                          <div className="truncate text-xs text-black/55">
                            {loc || (tab === "ct" ? "Connecticut" : "—")}
                          </div>
                        </div>
                      </div>

                      <div
                        className={cx(
                          "flex items-center gap-2",
                          "sm:opacity-0 sm:group-hover:opacity-100 transition"
                        )}
                      >
                        <Link
                          href={`/matches/new?course=${encodeURIComponent(c.name)}`}
                          className="rounded-xl border bg-white/80 px-3 py-2 text-sm font-semibold hover:bg-white"
                        >
                          Create
                        </Link>

                        {!isMember && (
                          <button
                            type="button"
                            onClick={() => addToMyClubs(c)}
                            className="rounded-xl border bg-emerald-950 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
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

        {status && <div className="text-sm text-red-600">{status}</div>}

        {showAdd && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
            <div className="w-full max-w-xl rounded-3xl border bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Add a club</div>
                <button
                  type="button"
                  className="rounded-xl border bg-white px-3 py-1.5 text-sm font-semibold hover:bg-black/5"
                  onClick={() => setShowAdd(false)}
                >
                  Close
                </button>
              </div>

              <form onSubmit={createClub} className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Club name</label>
                  <input
                    className="w-full rounded-2xl border px-3 py-2 text-sm"
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">City / Town</label>
                    <input
                      className="w-full rounded-2xl border px-3 py-2 text-sm"
                      value={newCity}
                      onChange={(e) => setNewCity(e.target.value)}
                      placeholder="Cromwell"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">State</label>
                    <input
                      className="w-full rounded-2xl border px-3 py-2 text-sm"
                      value={newState}
                      onChange={(e) => setNewState(e.target.value)}
                      placeholder="CT"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Logo URL (optional)</label>
                  <input
                    className="w-full rounded-2xl border px-3 py-2 text-sm"
                    value={newLogoUrl}
                    onChange={(e) => setNewLogoUrl(e.target.value)}
                    placeholder="https://…/logo.png"
                  />
                  <div className="text-xs text-black/55">
                    Next step: we’ll replace this with a real upload to Supabase
                    Storage.
                  </div>
                </div>

                <button className="rounded-2xl border bg-emerald-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900">
                  Create club
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}