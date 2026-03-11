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
 * GET /api/pool/pending-attestations
 * Returns completed pool listings AND matches where the user is the guest
 * and hasn't attested yet (with time gating).
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

    // --- Pool attestations ---
    const { data: myApps } = await admin
      .from("pool_applications")
      .select("listing_id")
      .eq("applicant_id", user.id)
      .eq("status", "accepted");

    if (myApps && myApps.length > 0) {
      const listingIds = myApps.map((a: any) => a.listing_id);

      const { data: completedListings } = await admin
        .from("pool_listings")
        .select("id, course_name, round_time, creator_id, hole_count")
        .in("id", listingIds)
        .eq("status", "completed");

      if (completedListings && completedListings.length > 0) {
        // Time gate filter
        const eligible = completedListings.filter((l: any) => {
          const gate = getTimeGate(l.hole_count ?? 18);
          return new Date(l.round_time).getTime() + gate < now;
        });

        if (eligible.length > 0) {
          const eligibleIds = eligible.map((l: any) => l.id);
          const { data: attestations } = await admin
            .from("pool_attestations")
            .select("listing_id")
            .eq("attester_id", user.id)
            .in("listing_id", eligibleIds);

          const attestedSet = new Set((attestations ?? []).map((a: any) => a.listing_id));

          for (const l of eligible) {
            if (!attestedSet.has(l.id)) {
              pending.push({
                id: l.id,
                type: "pool",
                course_name: l.course_name,
                round_time: l.round_time,
                creator_id: l.creator_id,
              });
            }
          }
        }
      }
    }

    // --- Match attestations (user is opponent in completed non-ladder matches) ---
    const { data: matches } = await admin
      .from("matches")
      .select("id, course_name, round_time, creator_id, hole_count")
      .eq("opponent_id", user.id)
      .eq("status", "completed")
      .eq("completed", true)
      .eq("is_ladder_match", false);

    if (matches) {
      for (const m of matches as any[]) {
        // Time gate
        if (m.round_time) {
          const gate = getTimeGate(m.hole_count ?? 18);
          if (new Date(m.round_time).getTime() + gate > now) continue;
        }

        // Check not already attested
        const { data: existing } = await admin
          .from("match_attestations")
          .select("id")
          .eq("match_id", m.id)
          .eq("attester_id", user.id)
          .maybeSingle();

        if (!existing) {
          pending.push({
            id: m.id,
            type: "match",
            course_name: m.course_name,
            round_time: m.round_time,
            creator_id: m.creator_id,
          });
        }
      }
    }

    // Fetch creator names for all pending
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
        p.creator_name = nameMap[p.creator_id] || "Organizer";
      }
    }

    return NextResponse.json({ pending });
  } catch (e: any) {
    console.error("pending attestations error:", e);
    return NextResponse.json({ pending: [] });
  }
}
