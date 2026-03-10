"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/supabase";

type ClubRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  logo_url: string | null;
};

type MembershipRow = {
  user_id: string;
  guest_fee: number | null;
};

type PlayerProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function toStringParam(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

export default function ClubProfilePage() {
  const params = useParams();
  const clubId = toStringParam((params as any)?.id);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const [meId, setMeId] = useState<string | null>(null);
  const [club, setClub] = useState<ClubRow | null>(null);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, PlayerProfile>>({});
  const [isMember, setIsMember] = useState(false);
  const [myGuestFee, setMyGuestFee] = useState<number | null>(null);

  async function loadClub(userId: string) {
    if (!clubId) return;

    try {
      setLoading(true);
      setStatus(null);

      // Fetch club info
      const { data: clubData, error: clubErr } = await supabase
        .from("clubs")
        .select("id, name, city, state, logo_url")
        .eq("id", clubId)
        .single();

      if (clubErr) {
        setStatus(clubErr.code === "PGRST116" ? "Club not found." : clubErr.message);
        setLoading(false);
        return;
      }

      setClub(clubData as ClubRow);

      // Fetch memberships
      const { data: memData, error: memErr } = await supabase
        .from("club_memberships")
        .select("user_id, guest_fee")
        .eq("club_id", clubId);

      if (memErr) {
        setStatus(memErr.message);
        setLoading(false);
        return;
      }

      const mems = (memData ?? []) as MembershipRow[];
      setMemberships(mems);

      // Check if current user is a member
      const myMembership = mems.find((m) => m.user_id === userId);
      setIsMember(!!myMembership);
      setMyGuestFee(myMembership?.guest_fee ?? null);

      // Fetch profiles for all members
      const memberIds = mems.map((m) => m.user_id);
      if (memberIds.length > 0) {
        const { data: profData, error: profErr } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url, handicap_index")
          .in("id", memberIds);

        if (!profErr && profData) {
          const map: Record<string, PlayerProfile> = {};
          for (const p of profData as any[]) {
            map[String(p.id)] = {
              id: String(p.id),
              display_name: p.display_name ?? null,
              avatar_url: p.avatar_url ?? null,
              handicap_index: p.handicap_index ?? null,
            };
          }
          setProfiles(map);
        }
      } else {
        setProfiles({});
      }

      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to load club");
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!clubId) return;

    let handled = false;

    function handleSession(session: { user: { id: string } } | null) {
      const user = session?.user ?? null;
      if (!user) {
        setMeId(null);
        setClub(null);
        setMemberships([]);
        setProfiles({});
        setStatus("Auth session missing");
        setLoading(false);
        return;
      }

      setMeId(user.id);
      loadClub(user.id);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      handleSession(session);
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, [clubId]);

  async function joinClub() {
    if (!meId || !clubId) return;

    setJoining(true);
    setStatus(null);

    const { error } = await supabase
      .from("club_memberships")
      .insert({ user_id: meId, club_id: clubId });

    if (error) {
      setStatus(error.message);
      setJoining(false);
      return;
    }

    setStatus("You have joined this club.");
    setJoining(false);
    await loadClub(meId);
  }

  if (!clubId) {
    return <div className="p-4 text-sm text-[var(--muted)]">Missing club id.</div>;
  }

  if (loading) {
    return (
      <div className="space-y-5">
        {/* Header skeleton */}
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 animate-pulse rounded-full bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)] border border-[var(--border)]" />
          <div className="space-y-2 flex-1">
            <div className="h-6 w-48 animate-pulse rounded-lg bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)] border border-[var(--border)]" style={{ animationDelay: "75ms" }} />
            <div className="h-4 w-32 animate-pulse rounded-lg bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)] border border-[var(--border)]" style={{ animationDelay: "150ms" }} />
          </div>
        </div>
        {/* Info skeleton */}
        <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "225ms" }} />
        {/* Members skeleton */}
        <div className="h-48 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "300ms" }} />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04]">
            <svg className="h-5 w-5 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-[var(--ink)]">Club not found</div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            {status || "This club does not exist or has been removed."}
          </div>
          <Link
            href="/clubs"
            className="mt-4 rounded-full border border-[var(--border)] bg-white/80 px-4 py-2 text-sm font-medium transition-all duration-200 hover:bg-white hover:shadow-sm"
          >
            Back to clubs
          </Link>
        </div>
      </div>
    );
  }

  const crest = initials(club.name);
  const location = [club.city, club.state].filter(Boolean).join(", ");

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm">
          {club.logo_url ? (
            <img
              src={club.logo_url}
              alt={club.name + " logo"}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-lg font-semibold">
              {crest}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{club.name}</h1>
          {location && (
            <div className="mt-0.5 text-sm text-[var(--muted)]">{location}</div>
          )}
        </div>
      </div>

      {/* Info + Actions */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            {location && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-[var(--muted)]">Location:</span>
                <span className="text-[var(--ink)]">{location}</span>
              </div>
            )}
            {isMember && myGuestFee != null && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-[var(--muted)]">Your guest fee:</span>
                <span className="text-[var(--ink)]">${myGuestFee}</span>
              </div>
            )}
            {isMember && (
              <div className="inline-flex items-center rounded-full bg-[var(--pine)]/10 px-2.5 py-1 text-xs font-medium text-[var(--pine)]">
                Member
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={"/matches/new?course=" + encodeURIComponent(club.name)}
              className="rounded-full bg-[var(--pine)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[1px]"
            >
              Create match
            </Link>
            {!isMember && (
              <button
                type="button"
                onClick={joinClub}
                disabled={joining}
                className="rounded-full border border-[var(--border)] bg-white/80 px-5 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-white hover:shadow-sm disabled:opacity-50"
              >
                {joining ? "Joining..." : "Join club"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Members list */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold tracking-tight">Members</div>
          <div className="text-xs text-[var(--muted)]">{memberships.length} member{memberships.length !== 1 ? "s" : ""}</div>
        </div>

        {memberships.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="text-sm text-[var(--muted)]">No members yet. Be the first to join!</div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {memberships.map((m) => {
              const profile = profiles[m.user_id];
              const name = profile?.display_name || "Unknown player";
              const avatarUrl = profile?.avatar_url;
              const handicap = profile?.handicap_index;
              const memberInitials = initials(name);

              return (
                <Link
                  key={m.user_id}
                  href={`/players/${m.user_id}`}
                  className="group rounded-xl border border-[var(--border)] bg-white/70 p-4 transition-all duration-200 hover:bg-white hover:shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-xs font-semibold">
                          {memberInitials}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--pine)] transition-colors">{name}</div>
                      {handicap != null && (
                        <div className="text-xs text-[var(--muted)]">
                          Handicap: {handicap}
                        </div>
                      )}
                    </div>
                    {m.user_id === meId && (
                      <span className="inline-flex items-center rounded-full bg-[var(--pine)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--pine)]">
                        You
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Back link */}
      <div>
        <Link
          href="/clubs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] transition-colors duration-200 hover:text-[var(--ink)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to clubs
        </Link>
      </div>

      {/* Status message */}
      {status && (
        <div className="rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm text-[var(--ink)] shadow-sm">
          {status}
        </div>
      )}
    </div>
  );
}
