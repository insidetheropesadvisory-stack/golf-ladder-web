import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/pool — list open pool listings with optional distance filtering
 * Query params: lat, lng, radius (miles), status
 */
export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const url = new URL(request.url);
    const lat = parseFloat(url.searchParams.get("lat") ?? "");
    const lng = parseFloat(url.searchParams.get("lng") ?? "");
    const radiusMiles = parseFloat(url.searchParams.get("radius") ?? "50");
    const statusFilter = url.searchParams.get("status") ?? "open";

    const admin = adminClient();

    // Auto-expire listings past 12h before round_time
    const expiryCutoff = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await admin
      .from("pool_listings")
      .update({ status: "expired" })
      .eq("status", "open")
      .lt("round_time", expiryCutoff);

    // Fetch listings
    let query = admin
      .from("pool_listings")
      .select("*")
      .eq("status", statusFilter)
      .gte("round_time", new Date().toISOString())
      .order("round_time", { ascending: true })
      .limit(50);

    const { data: listings, error: listErr } = await query;

    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }

    // Distance filter if coordinates provided
    let filtered = listings ?? [];
    if (!isNaN(lat) && !isNaN(lng) && radiusMiles > 0) {
      filtered = filtered.filter((l: any) => {
        if (l.latitude == null || l.longitude == null) return true; // show listings without coords
        const dist = haversine(lat, lng, l.latitude, l.longitude);
        return dist <= radiusMiles;
      });
    }

    // Fetch creator profiles
    const creatorIds = [...new Set(filtered.map((l: any) => l.creator_id))];
    let profiles: Record<string, any> = {};
    if (creatorIds.length > 0) {
      const { data: profData } = await admin
        .from("profiles")
        .select("id, display_name, handicap_index, avatar_url")
        .in("id", creatorIds);
      if (profData) {
        for (const p of profData) profiles[p.id] = p;
      }
    }

    // Fetch application counts and committed counts
    const listingIds = filtered.map((l: any) => l.id);
    let acceptedCounts: Record<string, number> = {};
    let committedCounts: Record<string, number> = {};
    let myApplications: Record<string, string> = {}; // listing_id -> status

    if (listingIds.length > 0) {
      const { data: apps } = await admin
        .from("pool_applications")
        .select("listing_id, status")
        .in("listing_id", listingIds)
        .eq("status", "accepted");
      if (apps) {
        for (const a of apps as any[]) {
          acceptedCounts[a.listing_id] = (acceptedCounts[a.listing_id] ?? 0) + 1;
        }
      }

      const { data: committed } = await admin
        .from("pool_committed")
        .select("listing_id")
        .in("listing_id", listingIds);
      if (committed) {
        for (const c of committed as any[]) {
          committedCounts[c.listing_id] = (committedCounts[c.listing_id] ?? 0) + 1;
        }
      }

      // Check if current user has applied
      const { data: myApps } = await admin
        .from("pool_applications")
        .select("listing_id, status")
        .in("listing_id", listingIds)
        .eq("applicant_id", user.id);
      if (myApps) {
        for (const a of myApps as any[]) {
          myApplications[a.listing_id] = a.status;
        }
      }
    }

    const enriched = filtered.map((l: any) => {
      const accepted = acceptedCounts[l.id] ?? 0;
      const committedCt = committedCounts[l.id] ?? 0;
      // total_slots = open slots for pool applicants (already excludes creator + committed)
      // slots_filled = accepted applicants only (for display: open = total_slots - accepted)
      return {
        ...l,
        creator: profiles[l.creator_id] ?? null,
        accepted_count: accepted,
        committed_count: committedCt,
        slots_filled: accepted,
        my_application: myApplications[l.id] ?? null,
        distance: !isNaN(lat) && !isNaN(lng) && l.latitude != null && l.longitude != null
          ? Math.round(haversine(lat, lng, l.latitude, l.longitude))
          : null,
      };
    });

    return NextResponse.json({ listings: enriched });
  } catch (e: any) {
    console.error("pool list error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/pool — create a new pool listing
 */
export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as any;

    const courseName = String(body.course_name ?? "").trim();
    const roundTime = String(body.round_time ?? "").trim();
    const totalSlots = Number(body.total_slots ?? 0);

    const holeCount = Number(body.hole_count ?? 18);

    if (!courseName) return NextResponse.json({ error: "Missing course name" }, { status: 400 });
    if (!roundTime) return NextResponse.json({ error: "Missing round time" }, { status: 400 });
    if (totalSlots < 1 || totalSlots > 3) return NextResponse.json({ error: "Slots must be 1-3" }, { status: 400 });
    if (holeCount !== 9 && holeCount !== 18) return NextResponse.json({ error: "Holes must be 9 or 18" }, { status: 400 });

    // Ensure round_time is at least 12 hours in the future
    const rt = new Date(roundTime);
    if (rt.getTime() < Date.now() + 12 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Round must be at least 12 hours from now" }, { status: 400 });
    }

    const admin = adminClient();

    // Geocode city/state to lat/lng for distance filtering
    let latitude: number | null = body.latitude ?? null;
    let longitude: number | null = body.longitude ?? null;
    const city = body.city || null;
    const state = body.state || null;

    if (latitude == null && (city || courseName)) {
      const coords = await geocodeLocation(courseName, city, state);
      if (coords) {
        latitude = coords.lat;
        longitude = coords.lng;
      }
    }

    const { data: listing, error: insErr } = await admin
      .from("pool_listings")
      .insert({
        creator_id: user.id,
        course_name: courseName,
        golf_course_api_id: body.golf_course_api_id || null,
        round_time: roundTime,
        total_slots: totalSlots,
        hole_count: holeCount,
        guest_fee: body.guest_fee != null ? Number(body.guest_fee) : null,
        selected_tee: body.selected_tee || null,
        notes: body.notes || null,
        auto_accept: body.auto_accept === true,
        latitude,
        longitude,
        city,
        state,
      })
      .select()
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // Add committed players
    const committedPlayers = body.committed_players ?? [];
    if (committedPlayers.length > 0 && listing) {
      const rows = committedPlayers.map((p: any) => ({
        listing_id: listing.id,
        player_id: p.id || null,
        player_name: p.name || null,
      }));
      await admin.from("pool_committed").insert(rows);
    }

    return NextResponse.json({ listing });
  } catch (e: any) {
    console.error("pool create error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/** Geocode a course location using OpenStreetMap Nominatim.
 *  Tries course name + city/state first for precision, falls back to city/state. */
async function geocodeLocation(
  courseName: string,
  city: string | null,
  state: string | null
): Promise<{ lat: number; lng: number } | null> {
  async function tryQuery(q: string): Promise<{ lat: number; lng: number } | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "GolfLadderApp/1.0" },
        signal: AbortSignal.timeout(5000),
      });
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

  // Try with course name + location for best accuracy
  if (city) {
    const precise = await tryQuery([courseName, city, state].filter(Boolean).join(", "));
    if (precise) return precise;
    // Fall back to just city/state
    const fallback = await tryQuery([city, state, "United States"].filter(Boolean).join(", "));
    if (fallback) return fallback;
  }

  // Last resort: just the course name
  return tryQuery(courseName);
}

/** Haversine distance in miles */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
