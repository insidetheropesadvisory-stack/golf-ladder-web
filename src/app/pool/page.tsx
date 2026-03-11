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

export default function PoolPage() {
  const [listings, setListings] = useState<PoolListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [radiusFilter, setRadiusFilter] = useState<number>(50);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "loading" | "ready" | "none">("idle");
  const [meId, setMeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "my">("open");

  // Load user session + profile city/state, then resolve coordinates
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      setMeId(session.user.id);

      setLocationStatus("loading");

      // Fetch profile city/state
      const { data: profile } = await supabase
        .from("profiles")
        .select("city, state")
        .eq("id", session.user.id)
        .single();

      const city = profile?.city ?? null;
      const state = profile?.state ?? null;

      if (city) {
        // Geocode their profile city/state
        const coords = await geocodeCity(city, state);
        if (coords) {
          setUserCoords(coords);
          setLocationLabel([city, state].filter(Boolean).join(", "));
          setLocationStatus("ready");
          return;
        }
      }

      // No profile location — show message
      setLocationStatus("none");
    }
    init();
  }, []);

  useEffect(() => {
    loadListings();
  }, [radiusFilter, userCoords]);

  async function loadListings() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({ status: "open" });
      if (userCoords) {
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

  const openListings = listings.filter((l) => l.creator_id !== meId);
  const myListings = listings.filter((l) => l.creator_id === meId);

  const displayedListings = tab === "my" ? myListings : openListings;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Pool</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Find open spots or offer yours</p>
        </div>
        <Link
          href="/pool/new"
          className="shrink-0 rounded-xl bg-[var(--pine)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
        >
          Offer Slots
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {(["open", "my"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cx(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              tab === t
                ? "bg-[var(--pine)] text-white"
                : "bg-black/[0.04] text-[var(--muted)] hover:bg-black/[0.07]"
            )}
          >
            {t === "open" ? `Open (${openListings.length})` : `My Listings (${myListings.length})`}
          </button>
        ))}
      </div>

      {/* Distance filter */}
      {tab === "open" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--muted)]">Within:</span>
            <div className="flex gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRadiusFilter(r.value)}
                  className={cx(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                    radiusFilter === r.value
                      ? "bg-[var(--pine)] text-white"
                      : "bg-black/[0.04] text-[var(--muted)] hover:bg-black/[0.07]"
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
              Searching from <span className="font-medium text-[var(--ink)]">{locationLabel}</span>
              <Link href="/profile" className="text-[var(--pine)] hover:underline ml-1">Change</Link>
            </div>
          )}
          {locationStatus === "none" && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-600">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
              Add your city in <Link href="/profile" className="font-medium underline">your profile</Link> to filter by distance
            </div>
          )}
          {locationStatus === "loading" && (
            <span className="text-[11px] text-[var(--muted)]">Getting your location...</span>
          )}
        </div>
      )}

      {/* Listings */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      ) : displayedListings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">
            {tab === "my" ? "You haven't offered any slots yet" : "No open slots nearby"}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {tab === "my"
              ? "Create a listing to let others join your round."
              : "Try expanding your search radius or check back later."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedListings.map((l) => {
            const slotsOpen = l.total_slots - l.slots_filled;
            return (
              <Link
                key={l.id}
                href={`/pool/${l.id}`}
                className="group block rounded-2xl border border-[var(--border)] bg-white/70 p-4 transition hover:border-[var(--pine)]/30 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold tracking-tight group-hover:text-[var(--pine)] transition-colors">
                        {l.course_name}
                      </div>
                      {l.distance != null && (
                        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                          {l.distance} mi
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted)]">
                      <span className="font-medium text-[var(--ink)]">{formatDate(l.round_time)}</span>
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
                          <span className="font-medium text-emerald-700">${l.guest_fee} guest fee</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {/* Creator */}
                      <div className="flex items-center gap-1.5">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--pine)] text-[8px] font-bold text-white">
                          {initials(l.creator?.display_name ?? "?")}
                        </div>
                        <span className="text-xs text-[var(--muted)]">
                          {l.creator?.display_name ?? "Organizer"}
                          {l.creator?.handicap_index != null && (
                            <span className="ml-1 text-amber-700">({l.creator.handicap_index})</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <span className={cx(
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      slotsOpen > 0
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200/60"
                        : "bg-slate-100 text-slate-500 border-slate-200/60"
                    )}>
                      {slotsOpen > 0 ? `${slotsOpen} slot${slotsOpen > 1 ? "s" : ""} open` : "Full"}
                    </span>
                    {l.my_application && (
                      <span className={cx(
                        "text-[10px] font-medium",
                        l.my_application === "accepted" ? "text-emerald-600" :
                        l.my_application === "denied" ? "text-red-500" : "text-amber-600"
                      )}>
                        {l.my_application === "accepted" ? "Accepted" :
                         l.my_application === "denied" ? "Declined" : "Pending"}
                      </span>
                    )}
                    {l.auto_accept && slotsOpen > 0 && (
                      <span className="text-[10px] text-[var(--muted)]">Auto-accept</span>
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

/** Geocode city/state to coordinates via Nominatim */
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
