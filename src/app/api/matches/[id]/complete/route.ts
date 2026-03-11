import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DEFAULT_HOLES = 18;

type HoleRow = { hole_no: number; player_id: string; strokes: number | null };

function sumStrokes(rows: HoleRow[], playerId: string): number {
  let total = 0;
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") total += r.strokes;
  }
  return total;
}

function countScoredHoles(rows: HoleRow[], playerId: string): number {
  const scored = new Set<number>();
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") {
      scored.add(r.hole_no);
    }
  }
  return scored.size;
}

function matchPlayResult(
  rows: HoleRow[],
  p1: string,
  p2: string,
  totalHoles = DEFAULT_HOLES
): { p1Holes: number; p2Holes: number; halved: number } {
  let p1Holes = 0;
  let p2Holes = 0;
  let halved = 0;

  for (let h = 1; h <= totalHoles; h++) {
    const s1 = rows.find((r) => r.player_id === p1 && r.hole_no === h)?.strokes;
    const s2 = rows.find((r) => r.player_id === p2 && r.hole_no === h)?.strokes;
    if (s1 == null || s2 == null) continue;
    if (s1 < s2) p1Holes++;
    else if (s2 < s1) p2Holes++;
    else halved++;
  }
  return { p1Holes, p2Holes, halved };
}

/**
 * POST /api/matches/[id]/complete
 *
 * Server-side match completion with score validation.
 * - Verifies caller is a participant
 * - Validates both players have scored all required holes
 * - Validates individual stroke values (1-20)
 * - Computes winner server-side
 * - Handles ladder swap if applicable
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
    if (!matchId) {
      return NextResponse.json({ error: "Missing match ID" }, { status: 400 });
    }

    const admin = adminClient();

    // 1. Fetch match
    const { data: match, error: matchErr } = await admin
      .from("matches")
      .select(
        "id, creator_id, opponent_id, status, completed, format, use_handicap, is_ladder_match, hole_count"
      )
      .eq("id", matchId)
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // 2. Verify caller is a participant
    if (user.id !== match.creator_id && user.id !== match.opponent_id) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    // 3. Check match isn't already completed
    if (match.completed || match.status === "completed") {
      return NextResponse.json({ error: "Match already completed" }, { status: 400 });
    }

    // 4. Check match is active
    if (match.status !== "active") {
      return NextResponse.json(
        { error: `Cannot complete a match with status "${match.status}"` },
        { status: 400 }
      );
    }

    // 5. Fetch all hole scores
    const { data: holeData, error: holeErr } = await admin
      .from("holes")
      .select("hole_no, player_id, strokes")
      .eq("match_id", matchId);

    if (holeErr) {
      return NextResponse.json({ error: "Failed to load scores" }, { status: 500 });
    }

    const rows = (holeData ?? []) as HoleRow[];

    // 6. Validate stroke values (1-20 per hole)
    for (const r of rows) {
      if (typeof r.strokes === "number" && (r.strokes < 1 || r.strokes > 20)) {
        return NextResponse.json(
          { error: `Invalid stroke value ${r.strokes} on hole ${r.hole_no}` },
          { status: 400 }
        );
      }
    }

    const creatorId = match.creator_id as string;
    const opponentId = match.opponent_id as string;
    const totalHoles = (match as any).hole_count ?? DEFAULT_HOLES;

    const creatorScoredCount = countScoredHoles(rows, creatorId);
    const opponentScoredCount = countScoredHoles(rows, opponentId);

    // 7. Validate scoring completeness
    if (match.format === "match_play") {
      const mp = matchPlayResult(rows, creatorId, opponentId, totalHoles);
      const holesPlayed = mp.p1Holes + mp.p2Holes + mp.halved;
      const diff = Math.abs(mp.p1Holes - mp.p2Holes);
      const remaining = totalHoles - holesPlayed;
      const clinched = diff > remaining && holesPlayed > 0;

      if (!clinched) {
        if (creatorScoredCount < totalHoles || opponentScoredCount < totalHoles) {
          return NextResponse.json(
            {
              error: "Both players must complete all holes before finishing",
              creatorHoles: creatorScoredCount,
              opponentHoles: opponentScoredCount,
            },
            { status: 400 }
          );
        }
      } else {
        // Clinched — both must have scored through the clinch point
        if (creatorScoredCount < holesPlayed || opponentScoredCount < holesPlayed) {
          return NextResponse.json(
            { error: "Both players must score through the clinch hole" },
            { status: 400 }
          );
        }
      }
    } else {
      // Stroke play: both must have scored all 18
      if (creatorScoredCount < totalHoles) {
        return NextResponse.json(
          {
            error: `Creator has only scored ${creatorScoredCount} of ${totalHoles} holes`,
          },
          { status: 400 }
        );
      }
      if (opponentScoredCount < totalHoles) {
        return NextResponse.json(
          {
            error: `Opponent has only scored ${opponentScoredCount} of ${totalHoles} holes`,
          },
          { status: 400 }
        );
      }
    }

    // 8. Compute totals server-side
    const creatorTotal = sumStrokes(rows, creatorId);
    const opponentTotal = sumStrokes(rows, opponentId);

    // 9. Mark match as completed
    const { error: updateErr } = await admin
      .from("matches")
      .update({ completed: true, status: "completed" })
      .eq("id", matchId);

    if (updateErr) {
      return NextResponse.json({ error: "Failed to update match" }, { status: 500 });
    }

    // 10. Determine winner and handle ladder swap
    let winnerId: string | null = null;
    let loserId: string | null = null;

    if (match.format === "match_play") {
      const mp = matchPlayResult(rows, creatorId, opponentId);
      if (mp.p1Holes > mp.p2Holes) {
        winnerId = creatorId;
        loserId = opponentId;
      } else if (mp.p2Holes > mp.p1Holes) {
        winnerId = opponentId;
        loserId = creatorId;
      }
    } else {
      // Stroke play — lower is better
      let creatorNet = creatorTotal;
      let opponentNet = opponentTotal;

      if (match.use_handicap) {
        const { data: profiles } = await admin
          .from("profiles")
          .select("id, handicap_index")
          .in("id", [creatorId, opponentId]);

        if (profiles) {
          for (const p of profiles as any[]) {
            if (p.id === creatorId && typeof p.handicap_index === "number") {
              creatorNet = creatorTotal - p.handicap_index;
            } else if (p.id === opponentId && typeof p.handicap_index === "number") {
              opponentNet = opponentTotal - p.handicap_index;
            }
          }
        }
      }

      if (creatorNet < opponentNet) {
        winnerId = creatorId;
        loserId = opponentId;
      } else if (opponentNet < creatorNet) {
        winnerId = opponentId;
        loserId = creatorId;
      }
    }

    // 11. Ladder swap if applicable
    if (match.is_ladder_match && winnerId && loserId) {
      const ladderTypes = ["gross"];
      if (match.use_handicap) ladderTypes.push("net");

      for (const ladderType of ladderTypes) {
        try {
          const { data: positions } = await admin
            .from("ladder_rankings")
            .select("id, user_id, position")
            .eq("type", ladderType)
            .in("user_id", [winnerId, loserId]);

          if (positions && positions.length === 2) {
            const winnerRow = positions.find((p: any) => p.user_id === winnerId);
            const loserRow = positions.find((p: any) => p.user_id === loserId);
            if (winnerRow && loserRow && winnerRow.position > loserRow.position) {
              const ts = new Date().toISOString();
              await admin
                .from("ladder_rankings")
                .update({ position: loserRow.position, updated_at: ts })
                .eq("id", winnerRow.id);
              await admin
                .from("ladder_rankings")
                .update({ position: winnerRow.position, updated_at: ts })
                .eq("id", loserRow.id);
            }
          }
        } catch {
          // Ladder swap is best-effort
        }
      }
    }

    // 12. Deduct 1 Tee from opponent for non-ladder matches
    if (!match.is_ladder_match) {
      const { data: oppProfile } = await admin
        .from("profiles")
        .select("credits")
        .eq("id", opponentId)
        .single();

      await admin
        .from("profiles")
        .update({ credits: Math.max(0, (oppProfile?.credits ?? 3) - 1) })
        .eq("id", opponentId);
    }

    return NextResponse.json({
      ok: true,
      creatorTotal,
      opponentTotal,
      winnerId,
      loserId,
    });
  } catch (e: any) {
    console.error("complete-match error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
