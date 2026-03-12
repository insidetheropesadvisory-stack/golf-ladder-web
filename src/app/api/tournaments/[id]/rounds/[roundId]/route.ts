import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";
import { evaluateUser } from "@/lib/badges/service";

export const runtime = "nodejs";

/**
 * GET /api/tournaments/[id]/rounds/[roundId]
 * Get round details + hole-by-hole scores. Any tournament participant can view.
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

    const { id: tournamentId, roundId } = await params;
    const admin = adminClient();

    // Verify participant
    const { data: myPart } = await admin
      .from("tournament_participants")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .maybeSingle();

    if (!myPart) {
      return NextResponse.json({ error: "You are not in this tournament" }, { status: 403 });
    }

    const { data: round } = await admin
      .from("tournament_rounds")
      .select("*")
      .eq("id", roundId)
      .eq("tournament_id", tournamentId)
      .single();

    if (!round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    // Get hole scores
    const { data: holes } = await admin
      .from("tournament_holes")
      .select("hole_no, strokes")
      .eq("tournament_round_id", roundId)
      .order("hole_no", { ascending: true });

    // Get player profile
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
 * POST /api/tournaments/[id]/rounds/[roundId]
 * Save a hole score (upsert). Auto-completes round when all 18 holes scored.
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

    const { id: tournamentId, roundId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const admin = adminClient();

    // Get round and verify ownership
    const { data: round } = await admin
      .from("tournament_rounds")
      .select("id, tournament_id, user_id, completed, course_rating, slope_rating, period_number")
      .eq("id", roundId)
      .eq("tournament_id", tournamentId)
      .single();

    if (!round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }
    if (round.user_id !== user.id) {
      return NextResponse.json({ error: "Not your round" }, { status: 403 });
    }
    if (round.completed) {
      return NextResponse.json({ error: "Round is already completed" }, { status: 400 });
    }

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
      .from("tournament_holes")
      .upsert(
        { tournament_round_id: roundId, hole_no: holeNo, strokes },
        { onConflict: "tournament_round_id,hole_no" }
      );

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    // Check if all 18 holes are scored
    const { data: allHoles } = await admin
      .from("tournament_holes")
      .select("hole_no, strokes")
      .eq("tournament_round_id", roundId);

    const scoredHoles = (allHoles ?? []).filter((h: any) => typeof h.strokes === "number");
    const allScored = scoredHoles.length >= 18;

    if (allScored) {
      // Calculate gross and differential
      const grossScore = scoredHoles.reduce((sum: number, h: any) => sum + h.strokes, 0);
      const differential = Math.round(((113 / round.slope_rating) * (grossScore - round.course_rating)) * 10) / 10;

      await admin
        .from("tournament_rounds")
        .update({ gross_score: grossScore, differential, completed: true })
        .eq("id", roundId);

      // Check for leader change and send notifications
      await checkLeaderChange(admin, tournamentId, round.period_number, user.id, differential);

      // Fire-and-forget badge evaluation
      evaluateUser(admin, user.id).catch(() => {});

      return NextResponse.json({
        saved: true,
        completed: true,
        gross_score: grossScore,
        differential,
        holes_scored: 18,
      });
    }

    return NextResponse.json({
      saved: true,
      completed: false,
      holes_scored: scoredHoles.length,
    });
  } catch (e: any) {
    console.error("tournament hole error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/tournaments/[id]/rounds/[roundId]
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

    const { id: tournamentId, roundId } = await params;
    const url = new URL(request.url);
    const holeNo = Number(url.searchParams.get("hole_no"));
    const admin = adminClient();

    if (!holeNo || holeNo < 1 || holeNo > 18) {
      return NextResponse.json({ error: "Invalid hole number" }, { status: 400 });
    }

    // Verify ownership and not completed
    const { data: round } = await admin
      .from("tournament_rounds")
      .select("id, user_id, completed")
      .eq("id", roundId)
      .eq("tournament_id", tournamentId)
      .single();

    if (!round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }
    if (round.user_id !== user.id) {
      return NextResponse.json({ error: "Not your round" }, { status: 403 });
    }
    if (round.completed) {
      return NextResponse.json({ error: "Round is already completed" }, { status: 400 });
    }

    await admin
      .from("tournament_holes")
      .delete()
      .eq("tournament_round_id", roundId)
      .eq("hole_no", holeNo);

    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * Check if a newly completed round makes the user the period leader.
 * If so, notify all other tournament participants.
 */
async function checkLeaderChange(
  admin: ReturnType<typeof adminClient>,
  tournamentId: string,
  periodNumber: number,
  userId: string,
  newDifferential: number
) {
  try {
    // Get all completed rounds for this period
    const { data: periodRounds } = await admin
      .from("tournament_rounds")
      .select("user_id, differential")
      .eq("tournament_id", tournamentId)
      .eq("period_number", periodNumber)
      .eq("completed", true)
      .order("differential", { ascending: true });

    if (!periodRounds || periodRounds.length === 0) return;

    // Check if this user is now in first place
    const leader = periodRounds[0];
    if (leader.user_id !== userId) return;

    // Only notify if there are other rounds to compare against (not if they're the only one)
    if (periodRounds.length < 2) return;

    // Get tournament info for period label
    const { data: tournament } = await admin
      .from("tournaments")
      .select("name, period_type")
      .eq("id", tournamentId)
      .single();

    const unit = tournament?.period_type === "weekly" ? "Week" : "Month";

    // Get the user's display name
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();

    const playerName = profile?.display_name || "A player";

    // Get all participants to notify
    const { data: participants } = await admin
      .from("tournament_participants")
      .select("user_id")
      .eq("tournament_id", tournamentId)
      .eq("status", "accepted");

    if (!participants) return;

    const msg = `${playerName} just took the lead for ${unit} ${periodNumber} in ${tournament?.name ?? "the tournament"} with a ${newDifferential.toFixed(1)} differential!`;

    for (const p of participants) {
      if (p.user_id === userId) continue; // Don't notify the leader themselves

      await admin.from("notifications").insert({
        user_id: p.user_id,
        message: msg,
        read: false,
      });

      sendPushToUser(p.user_id, {
        title: "New period leader!",
        body: msg,
        url: `/tournaments/${tournamentId}`,
      }).catch(() => {});
    }
  } catch {
    // Best effort — don't fail the round completion
  }
}
