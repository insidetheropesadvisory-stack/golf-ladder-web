"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type PoolListing = {
  id: string;
  creator_id: string;
  course_name: string;
  round_time: string;
  total_slots: number;
  guest_fee: number | null;
  notes: string | null;
  auto_accept: boolean;
  status: string;
  city: string | null;
  state: string | null;
  creator: { display_name: string | null; handicap_index: number | null; avatar_url: string | null } | null;
  slots_filled: number;
  my_application: string | null;
  distance: number | null;
};

const RADIUS_OPTIONS = [
  { label: "15 mi", value: 15 },
  { label: "25 mi", value: 25 },
  { label: "50 mi", value: 50 },
  { label: "Any", value: 0 },
];

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function timeUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Starting soon";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h away`;
  return `${hours}h away`;
}

export default function FindAMatchPage() {
  const [listings, setListings] = useState<PoolListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [radiusFilter, setRadiusFilter] = useState<number>(50);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "loading" | "ready" | "none">("idle");
  const [meId, setMeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "my" | "upcoming" | "completed">("open");
  const [credits, setCredits] = useState<number | null>(null);
  const [upcomingListings, setUpcomingListings] = useState<PoolListing[]>([]);
  const [completedListings, setCompletedListings] = useState<PoolListing[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [upcomingCount, setUpcomingCount] = useState<number | null>(null);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      setMeId(session.user.id);
      setLocationStatus("loading");

      const { data: profile } = await supabase
        .from("profiles")
        .select("city, state, credits")
        .eq("id", session.user.id)
        .single();

      if (profile) setCredits((profile as any).credits ?? 3);

      const city = profile?.city ?? null;
      const state = profile?.state ?? null;

      if (city) {
        const coords = await geocodeCity(city, state);
        if (coords) {
          setUserCoords(coords);
          setLocationLabel([city, state].filter(Boolean).join(", "));
          setLocationStatus("ready");
          return;
        }
      }
      setLocationStatus("none");
    }
    init();
    loadUpcomingCount();
  }, []);

  useEffect(() => { loadListings(); }, [radiusFilter, userCoords]);

  async function loadListings() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({ status: "open" });
      if (userCoords && radiusFilter > 0) {
        params.set("lat", String(userCoords.lat));
        params.set("lng", String(userCoords.lng));
        params.set("radius", String(radiusFilter));
      }
      const res = await fetch(`/api/pool?${params}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const json = await res.json();
      if (res.ok) setListings(json.listings ?? []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    if (tab === "upcoming") loadUpcoming();
    if (tab === "completed") loadCompleted();
  }, [tab]);

  async function loadUpcomingCount() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/pool?status=upcoming", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const json = await res.json();
      if (res.ok) {
        const list = json.listings ?? [];
        setUpcomingCount(list.length);
        setUpcomingListings(list);
      }
    } catch {}
  }

  async function loadUpcoming() {
    setUpcomingLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/pool?status=upcoming", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const json = await res.json();
      if (res.ok) {
        const list = json.listings ?? [];
        setUpcomingListings(list);
        setUpcomingCount(list.length);
      }
    } catch {}
    setUpcomingLoading(false);
  }

  async function loadCompleted() {
    setCompletedLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/pool?status=completed", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const json = await res.json();
      if (res.ok) setCompletedListings(json.listings ?? []);
    } catch {}
    setCompletedLoading(false);
  }

  const openListings = listings.filter((l) => l.creator_id !== meId);
  const myListings = listings.filter((l) => l.creator_id === meId);

  const displayedListings =
    tab === "my" ? myListings :
    tab === "upcoming" ? upcomingListings :
    tab === "completed" ? completedListings :
    openListings;

  const isTabLoading =
    tab === "upcoming" ? upcomingLoading :
    tab === "completed" ? completedLoading :
    loading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl tracking-tight text-[var(--ink)]">Find a Match</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Find open spots or post your own round — play anywhere, not just your home club.</p>
        </div>
        <Link
          href="/pool/new"
          className="btn-gold shrink-0"
        >
          Post a Round
        </Link>
      </div>

      {/* Tee balance */}
      {credits != null && (
        <div className="ds-card p-4">
          <div className="flex items-center gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M8.5 2L15.5 2C15.5 2 15 3.5 14.5 4.5C14.5 4.5 14 5 13.5 5L13.3 5L13 20C13 20.5 12.8 22 12 22C11.2 22 11 20.5 11 20L10.7 5L10.5 5C10 5 9.5 4.5 9.5 4.5C9 3.5 8.5 2 8.5 2Z" fill="var(--pine)" />
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold text-[var(--ink)]">{credits} Tee{credits !== 1 ? "s" : ""}</div>
              <div className="text-[11px] text-[var(--muted)]">Host rounds to earn more. 1 Tee per guest who confirms.</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { key: "open" as const, label: `Open (${openListings.length})` },
          { key: "my" as const, label: `My Listings (${myListings.length})` },
          { key: "upcoming" as const, label: upcomingCount != null && upcomingCount > 0 ? `Upcoming (${upcomingCount})` : "Upcoming" },
          { key: "completed" as const, label: "Completed" },
        ]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cx(
              "rounded-[3px] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition",
              tab === t.key
                ? "bg-[var(--pine)] text-[var(--gold)]"
                : "bg-[var(--green-light)] text-[var(--muted)] hover:bg-[var(--green-light)]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Distance filter (only for Open tab) */}
      {tab === "open" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Within:</span>
            <div className="flex gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRadiusFilter(r.value)}
                  className={cx(
                    "rounded-[3px] px-2.5 py-1 text-[11px] font-medium transition",
                    radiusFilter === r.value
                      ? "bg-[var(--gold)] text-[var(--pine)]"
                      : "bg-[var(--green-light)] text-[var(--muted)] hover:bg-[var(--gold-light)]"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {locationStatus === "ready" && locationLabel && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
              Searching from <span className="font-semibold text-[var(--ink)]">{locationLabel}</span>
              <Link href="/profile" className="text-[var(--gold)] hover:underline ml-1">Change</Link>
            </div>
          )}
          {locationStatus === "none" && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--tan)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
              Add your city in <Link href="/profile" className="font-semibold underline">your profile</Link> to filter by distance
            </div>
          )}
          {locationStatus === "loading" && (
            <span className="text-[11px] text-[var(--muted)]">Getting your location...</span>
          )}
        </div>
      )}

      {/* Listings */}
      {isTabLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)]"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      ) : displayedListings.length === 0 ? (
        <div className="ds-card p-8 text-center border-dashed">
          <div className="text-sm font-semibold text-[var(--ink)]">
            {tab === "my" ? "You haven't posted any rounds yet" :
             tab === "upcoming" ? "No upcoming rounds" :
             tab === "completed" ? "No completed rounds yet" :
             "No open rounds nearby"}
          </div>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {tab === "my"
              ? "Post a round to let others join you."
              : tab === "open"
              ? "Try expanding your radius or check back later."
              : "Rounds will appear here as they come in."}
          </p>
          {(tab === "open" || tab === "my") && (
            <Link href="/pool/new" className="btn-gold mt-4 inline-flex">Post a Round</Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {displayedListings.map((l) => {
            const slotsOpen = l.total_slots - l.slots_filled;
            return (
              <Link
                key={l.id}
                href={`/pool/${l.id}`}
                className="group block ds-card p-4 transition hover:border-[var(--pine)]/30 hover:shadow-[var(--shadow)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold tracking-tight group-hover:text-[var(--pine)] transition-colors">
                        {l.course_name}
                      </div>
                      {l.distance != null && (
                        <span className="shrink-0 rounded-[3px] bg-[var(--green-light)] px-2 py-0.5 text-[10px] font-bold text-[var(--pine)]">
                          {l.distance} mi
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted)]">
                      <span className="font-semibold text-[var(--ink)]">{formatDate(l.round_time)}</span>
                      <span className="text-[var(--border)]">/</span>
                      <span>{timeUntil(l.round_time)}</span>
                      {l.city && (
                        <>
                          <span className="text-[var(--border)]">/</span>
                          <span>{[l.city, l.state].filter(Boolean).join(", ")}</span>
                        </>
                      )}
                      {l.guest_fee != null && (
                        <>
                          <span className="text-[var(--border)]">/</span>
                          <span className="font-semibold text-[var(--pine)]">${l.guest_fee} guest fee</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--pine)] text-[8px] font-bold text-white">
                        {initials(l.creator?.display_name ?? "?")}
                      </div>
                      <span className="text-[11px] text-[var(--muted)]">
                        {l.creator?.display_name ?? "Organizer"}
                        {l.creator?.handicap_index != null && (
                          <span className="ml-1 text-[var(--tan)]">({l.creator.handicap_index})</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    {tab === "completed" ? (
                      <span className="pill-waiting text-[9px]">Done</span>
                    ) : tab === "upcoming" ? (
                      <span className="pill-live text-[9px]">Scheduled</span>
                    ) : (
                      <>
                        <span className={cx(
                          "rounded-[3px] border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                          slotsOpen > 0
                            ? "bg-[var(--green-light)] text-[var(--pine)] border-[var(--pine)]/20"
                            : "bg-[var(--paper)] text-[var(--muted)] border-[var(--border)]"
                        )}>
                          {slotsOpen > 0 ? `${slotsOpen} slot${slotsOpen > 1 ? "s" : ""} open` : "Full"}
                        </span>
                        {l.my_application && (
                          <span className={cx(
                            "text-[10px] font-semibold",
                            l.my_application === "accepted" ? "text-[var(--pine)]" :
                            l.my_application === "denied" ? "text-red-500" : "text-[var(--tan)]"
                          )}>
                            {l.my_application === "accepted" ? "Accepted" :
                             l.my_application === "denied" ? "Declined" : "Pending"}
                          </span>
                        )}
                        {l.auto_accept && slotsOpen > 0 && (
                          <span className="text-[10px] text-[var(--muted)]">Auto-accept</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function geocodeCity(
  city: string,
  state: string | null
): Promise<{ lat: number; lng: number } | null> {
  try {
    const q = [city, state, "United States"].filter(Boolean).join(", ");
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const results = await res.json();
    if (results.length === 0) return null;
    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
