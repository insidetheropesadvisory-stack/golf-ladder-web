import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Time gates in milliseconds */
const TIME_GATE_18 = 3 * 60 * 60 * 1000 + 15 * 60 * 1000; // 3:15
const TIME_GATE_9 = 1 * 60 * 60 * 1000 + 35 * 60 * 1000;  // 1:35

function getTimeGate(holeCount: number) {
  return holeCount === 9 ? TIME_GATE_9 : TIME_GATE_18;
}

/**
 * GET /api/pool/pending-completions
 * Returns pool listings AND matches the user created that are past time gate
 * and haven't been marked complete yet.
 */
export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ pending: [] });
    }

    const admin = adminClient();
    const now = Date.now();
    const pending: any[] = [];

    // --- Pool listings ---
    const { data: listings } = await admin
      .from("pool_listings")
      .select("id, course_name, round_time, hole_count")
      .eq("creator_id", user.id)
      .in("status", ["open", "full"]);

    if (listings) {
      const eligibleListings = listings.filter((l: any) => {
        const gate = getTimeGate(l.hole_count ?? 18);
        return new Date(l.round_time).getTime() + gate < now;
      });

      if (eligibleListings.length > 0) {
        const listingIds = eligibleListings.map((l: any) => l.id);
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

        for (const l of eligibleListings) {
          pending.push({
            id: l.id,
            type: "pool",
            course_name: l.course_name,
            round_time: l.round_time,
            accepted_count: acceptedCounts[l.id] ?? 0,
          });
        }
      }
    }

    // --- Matches (non-ladder) where creator, completed, no attestation yet ---
    const { data: matches } = await admin
      .from("matches")
      .select("id, course_name, round_time, hole_count, status, completed")
      .eq("creator_id", user.id)
      .eq("status", "completed")
      .eq("completed", true)
      .eq("is_ladder_match", false);

    if (matches) {
      for (const m of matches as any[]) {
        // Check time gate
        if (m.round_time) {
          const gate = getTimeGate(m.hole_count ?? 18);
          if (new Date(m.round_time).getTime() + gate > now) continue;
        }

        // Check no attestation exists yet
        const { data: existing } = await admin
          .from("match_attestations")
          .select("id")
          .eq("match_id", m.id)
          .maybeSingle();

        if (!existing) {
          pending.push({
            id: m.id,
            type: "match",
            course_name: m.course_name,
            round_time: m.round_time,
            accepted_count: 1,
          });
        }
      }
    }

    return NextResponse.json({ pending });
  } catch (e: any) {
    console.error("pending completions error:", e);
    return NextResponse.json({ pending: [] });
  }
}
