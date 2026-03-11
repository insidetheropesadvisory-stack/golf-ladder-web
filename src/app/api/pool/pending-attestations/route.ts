import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/pool/pending-attestations
 * Returns completed pool listings where the user was accepted but hasn't attested yet.
 */
export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ pending: [] });
    }

    const admin = adminClient();

    // Find accepted applications for this user
    const { data: myApps } = await admin
      .from("pool_applications")
      .select("listing_id")
      .eq("applicant_id", user.id)
      .eq("status", "accepted");

    if (!myApps || myApps.length === 0) {
      return NextResponse.json({ pending: [] });
    }

    const listingIds = myApps.map((a: any) => a.listing_id);

    // Find completed listings
    const { data: completedListings } = await admin
      .from("pool_listings")
      .select("id, course_name, round_time, creator_id")
      .in("id", listingIds)
      .eq("status", "completed");

    if (!completedListings || completedListings.length === 0) {
      return NextResponse.json({ pending: [] });
    }

    // Check which ones the user already attested
    const completedIds = completedListings.map((l: any) => l.id);
    const { data: attestations } = await admin
      .from("pool_attestations")
      .select("listing_id")
      .eq("attester_id", user.id)
      .in("listing_id", completedIds);

    const attestedSet = new Set((attestations ?? []).map((a: any) => a.listing_id));

    // Filter to unattested
    const pending = completedListings
      .filter((l: any) => !attestedSet.has(l.id))
      .map((l: any) => ({
        id: l.id,
        course_name: l.course_name,
        round_time: l.round_time,
        creator_id: l.creator_id,
      }));

    // Fetch creator names
    if (pending.length > 0) {
      const creatorIds = [...new Set(pending.map((p: any) => p.creator_id))];
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, display_name")
        .in("id", creatorIds);

      const nameMap: Record<string, string> = {};
      if (profiles) {
        for (const p of profiles) nameMap[p.id] = p.display_name || "Organizer";
      }

      for (const p of pending) {
        (p as any).creator_name = nameMap[p.creator_id] || "Organizer";
      }
    }

    return NextResponse.json({ pending });
  } catch (e: any) {
    console.error("pending attestations error:", e);
    return NextResponse.json({ pending: [] });
  }
}
