import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/matches/[id]/confirm-round
 * Creator confirms the match round is complete → deducts 1 Tee from opponent.
 * Same protocol as pool's complete_round action.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: authErr } = await getAuthedUser(request);
    if (authErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: matchId } = await params;
    const admin = adminClient();

    const { data: match } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, status, completed, is_ladder_match, hole_count, round_time")
      .eq("id", matchId)
      .single();

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (user.id !== match.creator_id) {
      return NextResponse.json({ error: "Only the match creator can confirm" }, { status: 403 });
    }

    if (!match.completed || match.status !== "completed") {
      return NextResponse.json({ error: "Match must be completed first" }, { status: 400 });
    }

    if (match.is_ladder_match) {
      return NextResponse.json({ error: "Ladder matches don't use Tees" }, { status: 400 });
    }

    // Time gate check
    if (match.round_time) {
      const holeCount = (match as any).hole_count ?? 18;
      const timeGate = holeCount === 9
        ? 1 * 60 * 60 * 1000 + 35 * 60 * 1000
        : 3 * 60 * 60 * 1000 + 15 * 60 * 1000;
      if (new Date(match.round_time).getTime() + timeGate > Date.now()) {
        return NextResponse.json({ error: "Too soon — time gate not passed" }, { status: 400 });
      }
    }

    // Check not already confirmed (idempotent check via match_attestations from host side)
    const { data: existing } = await admin
      .from("match_attestations")
      .select("id")
      .eq("match_id", matchId)
      .eq("attester_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true }); // already done
    }

    // Insert creator's confirmation record
    await admin.from("match_attestations").insert({
      match_id: matchId,
      attester_id: user.id,
      host_id: user.id,
    });

    // Deduct 1 Tee from opponent
    const opponentId = match.opponent_id as string;
    const { data: oppProfile } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", opponentId)
      .single();

    await admin
      .from("profiles")
      .update({ credits: Math.max(0, (oppProfile?.credits ?? 3) - 1) })
      .eq("id", opponentId);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("match confirm-round error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
