import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/ladder-matches/[id]
 * Get challenge details with rounds and profiles.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: challengeId } = await params;
    const admin = adminClient();

    const { data: challenge } = await admin
      .from("ladder_challenges")
      .select("*")
      .eq("id", challengeId)
      .single();

    if (!challenge) {
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    }

    // Verify participant
    if (challenge.challenger_id !== user.id && challenge.opponent_id !== user.id) {
      return NextResponse.json({ error: "Not your challenge" }, { status: 403 });
    }

    // Get rounds
    const { data: rounds } = await admin
      .from("ladder_rounds")
      .select("*")
      .eq("challenge_id", challengeId);

    // Get hole scores for completed rounds
    const roundIds = (rounds ?? []).map((r: any) => r.id);
    let holesByRound: Record<string, any[]> = {};
    if (roundIds.length > 0) {
      const { data: holes } = await admin
        .from("ladder_holes")
        .select("ladder_round_id, hole_no, strokes")
        .in("ladder_round_id", roundIds)
        .order("hole_no", { ascending: true });
      if (holes) {
        for (const h of holes) {
          if (!holesByRound[h.ladder_round_id]) holesByRound[h.ladder_round_id] = [];
          holesByRound[h.ladder_round_id].push(h);
        }
      }
    }

    // Get profiles
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name, avatar_url, handicap_index")
      .in("id", [challenge.challenger_id, challenge.opponent_id]);

    const profileMap: Record<string, any> = {};
    for (const p of profiles ?? []) profileMap[p.id] = p;

    // Get ladder positions
    const { data: rankings } = await admin
      .from("ladder_rankings")
      .select("user_id, position, type")
      .eq("type", "gross")
      .in("user_id", [challenge.challenger_id, challenge.opponent_id]);

    const positionMap: Record<string, number> = {};
    for (const r of rankings ?? []) positionMap[r.user_id] = r.position;

    return NextResponse.json({
      challenge,
      rounds: rounds ?? [],
      holes: holesByRound,
      profiles: profileMap,
      positions: positionMap,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
