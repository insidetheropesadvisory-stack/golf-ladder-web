import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** 4 hours in milliseconds */
const FOUR_HOURS = 4 * 60 * 60 * 1000;

/**
 * GET /api/pool/pending-completions
 * Returns pool listings the user created that are past tee time + 5h
 * and haven't been marked complete yet.
 */
export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ pending: [] });
    }

    const admin = adminClient();

    // Listings created by this user that are open/full and past round_time + 5h
    const cutoff = new Date(Date.now() - FOUR_HOURS).toISOString();

    const { data: listings } = await admin
      .from("pool_listings")
      .select("id, course_name, round_time")
      .eq("creator_id", user.id)
      .in("status", ["open", "full"])
      .lt("round_time", cutoff);

    if (!listings || listings.length === 0) {
      return NextResponse.json({ pending: [] });
    }

    // Get accepted counts for each listing
    const listingIds = listings.map((l: any) => l.id);
    const { data: apps } = await admin
      .from("pool_applications")
      .select("listing_id")
      .in("listing_id", listingIds)
      .eq("status", "accepted");

    const acceptedCounts: Record<string, number> = {};
    if (apps) {
      for (const a of apps as any[]) {
        acceptedCounts[a.listing_id] = (acceptedCounts[a.listing_id] ?? 0) + 1;
      }
    }

    const pending = listings.map((l: any) => ({
      id: l.id,
      course_name: l.course_name,
      round_time: l.round_time,
      accepted_count: acceptedCounts[l.id] ?? 0,
    }));

    return NextResponse.json({ pending });
  } catch (e: any) {
    console.error("pending completions error:", e);
    return NextResponse.json({ pending: [] });
  }
}
