import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/matches/[id]/rounds/[roundId]
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

    const { id: matchId, roundId } = await params;
    const admin = adminClient();

    // Verify participant
    const { data: match } = await admin
      .from("matches")
      .select("creator_id, opponent_id")
      .eq("id", matchId)
      .single();

    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (match.creator_id !== user.id && match.opponent_id !== user.id) {
      return NextResponse.json({ error: "Not your match" }, { status: 403 });
    }

    const { data: round } = await admin
      .from("match_rounds")
      .select("*")
      .eq("id", roundId)
      .eq("match_id", matchId)
      .single();

    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

    const { data: holes } = await admin
      .from("match_holes")
      .select("id, match_round_id, hole_no, strokes")
      .eq("match_round_id", roundId)
      .order("hole_no", { ascending: true });

    return NextResponse.json({ round, holes: holes ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/matches/[id]/rounds/[roundId]
 * Save a hole score. Auto-completes round when all 18 scored.
 * When both rounds complete, determines winner based on scoring_type.
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

    const { id: matchId, roundId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const admin = adminClient();

    // Verify round ownership
    const { data: round } = await admin
      .from("match_rounds")
      .select("id, match_id, user_id, completed, course_rating, slope_rating, par")
      .eq("id", roundId)
      .eq("match_id", matchId)
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
      .from("match_holes")
      .upsert(
        { match_round_id: roundId, hole_no: holeNo, strokes },
        { onConflict: "match_round_id,hole_no" }
      );

    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

    // Check if all 18 scored
    const { data: allHoles } = await admin
      .from("match_holes")
      .select("hole_no, strokes")
      .eq("match_round_id", roundId);

    const scoredHoles = (allHoles ?? []).filter((h: any) => typeof h.strokes === "number");
    const allScored = scoredHoles.length >= 18;

    if (allScored) {
      const grossScore = scoredHoles.reduce((sum: number, h: any) => sum + h.strokes, 0);
      const differential =
        Math.round(((113 / round.slope_rating) * (grossScore - round.course_rating)) * 10) / 10;

      await admin
        .from("match_rounds")
        .update({ gross_score: grossScore, differential, completed: true })
        .eq("id", roundId);

      // Check if both rounds are now complete → resolve match
      const matchCompleted = await tryResolveMatch(admin, matchId);

      return NextResponse.json({
        saved: true,
        completed: true,
        gross_score: grossScore,
        differential,
        holes_scored: 18,
        matchCompleted,
      });
    }

    return NextResponse.json({ saved: true, completed: false, holes_scored: scoredHoles.length });
  } catch (e: any) {
    console.error("match hole save error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/matches/[id]/rounds/[roundId]
 * Delete a hole score (undo). Body: { hole_no }
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

    const { id: matchId, roundId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const holeNo = Number(body.hole_no);
    const admin = adminClient();

    if (!holeNo || holeNo < 1 || holeNo > 18) {
      return NextResponse.json({ error: "Invalid hole number" }, { status: 400 });
    }

    const { data: round } = await admin
      .from("match_rounds")
      .select("id, user_id, completed")
      .eq("id", roundId)
      .eq("match_id", matchId)
      .single();

    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
    if (round.user_id !== user.id) return NextResponse.json({ error: "Not your round" }, { status: 403 });
    if (round.completed) return NextResponse.json({ error: "Round is already completed" }, { status: 400 });

    await admin
      .from("match_holes")
      .delete()
      .eq("match_round_id", roundId)
      .eq("hole_no", holeNo);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Match resolution
// ---------------------------------------------------------------------------

/**
 * When both players' rounds are complete, determine the winner.
 * - stroke_play: lower differential wins
 * - match_play: hole-by-hole net comparison using cross-course handicap
 */
async function tryResolveMatch(
  admin: ReturnType<typeof adminClient>,
  matchId: string
): Promise<boolean> {
  try {
    const { data: match } = await admin
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (!match || match.status === "completed") return false;

    const { data: rounds } = await admin
      .from("match_rounds")
      .select("*")
      .eq("match_id", matchId);

    if (!rounds || rounds.length < 2) return false;

    const allComplete = rounds.every((r: any) => r.completed);
    if (!allComplete) return false;

    const creatorRound = rounds.find((r: any) => r.user_id === match.creator_id);
    const opponentRound = rounds.find((r: any) => r.user_id === match.opponent_id);

    if (!creatorRound || !opponentRound) return false;

    const scoringType = match.format ?? "stroke_play";

    let winnerId: string | null = null;

    if (scoringType === "match_play") {
      winnerId = await resolveMatchPlay(admin, match, creatorRound, opponentRound);
    } else {
      // stroke_play — lower differential wins
      const cDiff = Number(creatorRound.differential);
      const oDiff = Number(opponentRound.differential);

      if (cDiff < oDiff) winnerId = match.creator_id;
      else if (oDiff < cDiff) winnerId = match.opponent_id;
      // tied → null (draw)
    }

    await admin
      .from("matches")
      .update({
        status: "completed",
        completed: true,
      })
      .eq("id", matchId);

    return true;
  } catch (e) {
    console.error("tryResolveMatch error:", e);
    return false;
  }
}

/**
 * Match-play resolution for different-courses.
 *
 * Course handicap per player = handicap_index * (slope / 113) + (rating - par).
 * The higher-hcp player receives strokes equal to the difference, applied on
 * their OWN course's hardest holes (by hole_no order as proxy for difficulty).
 *
 * Each hole is compared net: lower net score wins the hole.
 * The player who wins more holes wins the match.
 */
async function resolveMatchPlay(
  admin: ReturnType<typeof adminClient>,
  match: any,
  creatorRound: any,
  opponentRound: any
): Promise<string | null> {
  // Fetch profiles for handicap_index
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, handicap_index")
    .in("id", [match.creator_id, match.opponent_id]);

  const profMap: Record<string, number> = {};
  for (const p of profiles ?? []) {
    profMap[p.id] = Number(p.handicap_index ?? 0);
  }

  const creatorIndex = profMap[match.creator_id] ?? 0;
  const opponentIndex = profMap[match.opponent_id] ?? 0;

  const creatorPar = Number(creatorRound.par ?? 72);
  const opponentPar = Number(opponentRound.par ?? 72);

  // Course handicap = index * (slope / 113) + (rating - par)
  const creatorCourseHcp =
    creatorIndex * (Number(creatorRound.slope_rating) / 113) +
    (Number(creatorRound.course_rating) - creatorPar);
  const opponentCourseHcp =
    opponentIndex * (Number(opponentRound.slope_rating) / 113) +
    (Number(opponentRound.course_rating) - opponentPar);

  const strokeDiff = Math.abs(creatorCourseHcp - opponentCourseHcp);
  const strokesGiven = Math.round(strokeDiff);

  // Who gets strokes? The higher course-hcp player
  const creatorGetsStrokes = creatorCourseHcp > opponentCourseHcp;

  // Fetch hole scores for both rounds
  const { data: creatorHoles } = await admin
    .from("match_holes")
    .select("hole_no, strokes")
    .eq("match_round_id", creatorRound.id)
    .order("hole_no", { ascending: true });

  const { data: opponentHoles } = await admin
    .from("match_holes")
    .select("hole_no, strokes")
    .eq("match_round_id", opponentRound.id)
    .order("hole_no", { ascending: true });

  const cMap: Record<number, number> = {};
  for (const h of creatorHoles ?? []) cMap[h.hole_no] = h.strokes;

  const oMap: Record<number, number> = {};
  for (const h of opponentHoles ?? []) oMap[h.hole_no] = h.strokes;

  // Stroke holes: hardest holes on the receiving player's OWN course
  // We use hole_no ascending as a proxy (holes 1..strokesGiven get strokes)
  const strokeHoles = new Set<number>();
  for (let i = 1; i <= strokesGiven && i <= 18; i++) {
    strokeHoles.add(i);
  }

  let creatorWins = 0;
  let opponentWins = 0;

  for (let hole = 1; hole <= 18; hole++) {
    let cNet = cMap[hole] ?? 0;
    let oNet = oMap[hole] ?? 0;

    if (!cNet || !oNet) continue; // skip if missing

    // Apply strokes on the receiving player's holes
    if (creatorGetsStrokes && strokeHoles.has(hole)) {
      cNet -= 1;
    } else if (!creatorGetsStrokes && strokeHoles.has(hole)) {
      oNet -= 1;
    }

    if (cNet < oNet) creatorWins++;
    else if (oNet < cNet) opponentWins++;
  }

  if (creatorWins > opponentWins) return match.creator_id;
  if (opponentWins > creatorWins) return match.opponent_id;
  return null; // halved
}
