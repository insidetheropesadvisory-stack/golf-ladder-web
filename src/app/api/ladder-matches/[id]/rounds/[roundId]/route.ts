import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";
import { evaluateUser } from "@/lib/badges/service";

export const runtime = "nodejs";

/**
 * GET /api/ladder-matches/[id]/rounds/[roundId]
 * Get round details + hole scores.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; roundId: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: challengeId, roundId } = await params;
    const admin = adminClient();

    // Verify participant
    const { data: challenge } = await admin
      .from("ladder_challenges")
      .select("challenger_id, opponent_id")
      .eq("id", challengeId)
      .single();

    if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    if (challenge.challenger_id !== user.id && challenge.opponent_id !== user.id) {
      return NextResponse.json({ error: "Not your challenge" }, { status: 403 });
    }

    const { data: round } = await admin
      .from("ladder_rounds")
      .select("*")
      .eq("id", roundId)
      .eq("challenge_id", challengeId)
      .single();

    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

    const { data: holes } = await admin
      .from("ladder_holes")
      .select("hole_no, strokes")
      .eq("ladder_round_id", roundId)
      .order("hole_no", { ascending: true });

    const { data: profile } = await admin
      .from("profiles")
      .select("id, display_name, avatar_url, handicap_index")
      .eq("id", round.user_id)
      .single();

    return NextResponse.json({ round, holes: holes ?? [], profile });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/ladder-matches/[id]/rounds/[roundId]
 * Save a hole score. Auto-completes round when all 18 scored.
 * When both rounds are complete, determines winner and triggers ladder swap.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; roundId: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: challengeId, roundId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const admin = adminClient();

    // Verify round ownership
    const { data: round } = await admin
      .from("ladder_rounds")
      .select("id, challenge_id, user_id, completed, course_rating, slope_rating")
      .eq("id", roundId)
      .eq("challenge_id", challengeId)
      .single();

    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
    if (round.user_id !== user.id) return NextResponse.json({ error: "Not your round" }, { status: 403 });
    if (round.completed) return NextResponse.json({ error: "Round is already completed" }, { status: 400 });

    const holeNo = Number(body.hole_no);
    const strokes = Number(body.strokes);

    if (!holeNo || holeNo < 1 || holeNo > 18) {
      return NextResponse.json({ error: "Invalid hole number (1-18)" }, { status: 400 });
    }
    if (!strokes || strokes < 1 || strokes > 20) {
      return NextResponse.json({ error: "Strokes must be between 1 and 20" }, { status: 400 });
    }

    // Upsert hole score
    const { error: upsertErr } = await admin
      .from("ladder_holes")
      .upsert(
        { ladder_round_id: roundId, hole_no: holeNo, strokes },
        { onConflict: "ladder_round_id,hole_no" }
      );

    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

    // Check if all 18 scored
    const { data: allHoles } = await admin
      .from("ladder_holes")
      .select("hole_no, strokes")
      .eq("ladder_round_id", roundId);

    const scoredHoles = (allHoles ?? []).filter((h: any) => typeof h.strokes === "number");
    const allScored = scoredHoles.length >= 18;

    if (allScored) {
      const grossScore = scoredHoles.reduce((sum: number, h: any) => sum + h.strokes, 0);
      const differential = Math.round(((113 / round.slope_rating) * (grossScore - round.course_rating)) * 10) / 10;

      await admin
        .from("ladder_rounds")
        .update({ gross_score: grossScore, differential, completed: true })
        .eq("id", roundId);

      // Check if both rounds are now complete → resolve challenge
      const resolved = await tryResolveChallenge(admin, challengeId);

      return NextResponse.json({
        saved: true,
        completed: true,
        gross_score: grossScore,
        differential,
        holes_scored: 18,
        challenge_resolved: resolved,
      });
    }

    return NextResponse.json({ saved: true, completed: false, holes_scored: scoredHoles.length });
  } catch (e: any) {
    console.error("ladder hole error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/ladder-matches/[id]/rounds/[roundId]?hole_no=N
 * Delete a hole score (undo).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; roundId: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: challengeId, roundId } = await params;
    const url = new URL(request.url);
    const holeNo = Number(url.searchParams.get("hole_no"));
    const admin = adminClient();

    if (!holeNo || holeNo < 1 || holeNo > 18) {
      return NextResponse.json({ error: "Invalid hole number" }, { status: 400 });
    }

    const { data: round } = await admin
      .from("ladder_rounds")
      .select("id, user_id, completed")
      .eq("id", roundId)
      .eq("challenge_id", challengeId)
      .single();

    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
    if (round.user_id !== user.id) return NextResponse.json({ error: "Not your round" }, { status: 403 });
    if (round.completed) return NextResponse.json({ error: "Round is already completed" }, { status: 400 });

    await admin
      .from("ladder_holes")
      .delete()
      .eq("ladder_round_id", roundId)
      .eq("hole_no", holeNo);

    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * When both players' rounds are complete, determine the winner by differential
 * and trigger the ladder swap.
 */
async function tryResolveChallenge(
  admin: ReturnType<typeof adminClient>,
  challengeId: string
): Promise<boolean> {
  try {
    const { data: challenge } = await admin
      .from("ladder_challenges")
      .select("*")
      .eq("id", challengeId)
      .single();

    if (!challenge || challenge.status !== "accepted") return false;

    const { data: rounds } = await admin
      .from("ladder_rounds")
      .select("user_id, differential, completed")
      .eq("challenge_id", challengeId);

    if (!rounds || rounds.length < 2) return false;

    const allComplete = rounds.every((r: any) => r.completed);
    if (!allComplete) return false;

    const challengerRound = rounds.find((r: any) => r.user_id === challenge.challenger_id);
    const opponentRound = rounds.find((r: any) => r.user_id === challenge.opponent_id);

    if (!challengerRound || !opponentRound) return false;

    const cDiff = Number(challengerRound.differential);
    const oDiff = Number(opponentRound.differential);

    // Lower differential wins
    let winnerId: string | null = null;
    if (cDiff < oDiff) winnerId = challenge.challenger_id;
    else if (oDiff < cDiff) winnerId = challenge.opponent_id;
    // If tied, no swap (defender keeps position)

    // Update challenge with result
    await admin
      .from("ladder_challenges")
      .update({
        status: "completed",
        winner_id: winnerId,
        challenger_differential: cDiff,
        opponent_differential: oDiff,
        updated_at: new Date().toISOString(),
      })
      .eq("id", challengeId);

    // Perform ladder swap if winner was ranked lower
    if (winnerId) {
      const loserId = winnerId === challenge.challenger_id
        ? challenge.opponent_id
        : challenge.challenger_id;

      for (const ladderType of ["gross", "net"]) {
        const { data: positions } = await admin
          .from("ladder_rankings")
          .select("id, user_id, position")
          .eq("type", ladderType)
          .in("user_id", [winnerId, loserId]);

        if (!positions || positions.length < 2) continue;

        const winnerRow = positions.find((p: any) => p.user_id === winnerId);
        const loserRow = positions.find((p: any) => p.user_id === loserId);

        if (winnerRow && loserRow && winnerRow.position > loserRow.position) {
          const now = new Date().toISOString();
          await admin
            .from("ladder_rankings")
            .update({ position: loserRow.position, updated_at: now })
            .eq("id", winnerRow.id);
          await admin
            .from("ladder_rankings")
            .update({ position: winnerRow.position, updated_at: now })
            .eq("id", loserRow.id);
        }
      }
    }

    // Notify both players
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", [challenge.challenger_id, challenge.opponent_id]);

    const nameMap: Record<string, string> = {};
    for (const p of profiles ?? []) nameMap[p.id] = p.display_name || "A player";

    const resultMsg = winnerId
      ? `${nameMap[winnerId]} wins the ladder challenge (${cDiff.toFixed(1)} vs ${oDiff.toFixed(1)})!`
      : `Ladder challenge tied at ${cDiff.toFixed(1)} — positions unchanged.`;

    for (const playerId of [challenge.challenger_id, challenge.opponent_id]) {
      await admin.from("notifications").insert({
        user_id: playerId,
        message: resultMsg,
        read: false,
      });

      sendPushToUser(playerId, {
        title: "Ladder Challenge Complete",
        body: resultMsg,
        url: `/ladder/challenge/${challengeId}`,
      }).catch(() => {});

      // Fire-and-forget badge evaluation
      evaluateUser(admin, playerId).catch(() => {});
    }

    return true;
  } catch (e) {
    console.error("tryResolveChallenge error:", e);
    return false;
  }
}
