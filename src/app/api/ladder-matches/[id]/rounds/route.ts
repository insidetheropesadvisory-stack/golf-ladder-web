import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/ladder-matches/[id]/rounds
 * Start a round for a ladder challenge. Creates a draft round for hole-by-hole scoring.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: challengeId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const admin = adminClient();

    // Verify challenge exists and user is a participant
    const { data: challenge } = await admin
      .from("ladder_challenges")
      .select("*")
      .eq("id", challengeId)
      .single();

    if (!challenge) {
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    }

    if (challenge.challenger_id !== user.id && challenge.opponent_id !== user.id) {
      return NextResponse.json({ error: "Not your challenge" }, { status: 403 });
    }

    if (challenge.status !== "accepted") {
      return NextResponse.json({ error: "Challenge must be accepted before submitting rounds" }, { status: 400 });
    }

    // Check deadline
    const deadlineEnd = new Date(challenge.deadline + "T23:59:59");
    if (new Date() > deadlineEnd) {
      return NextResponse.json({ error: "Challenge deadline has passed" }, { status: 400 });
    }

    // Check user hasn't already submitted a round
    const { data: existingRound } = await admin
      .from("ladder_rounds")
      .select("id")
      .eq("challenge_id", challengeId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingRound) {
      return NextResponse.json({ error: "You already have a round for this challenge" }, { status: 400 });
    }

    // Validate input
    const courseName = String(body.course_name ?? "").trim();
    const teeName = String(body.tee_name ?? "").trim() || null;
    const courseRating = Number(body.course_rating);
    const slopeRating = Number(body.slope_rating);
    const par = body.par != null ? Number(body.par) : null;
    const playedAt = String(body.played_at ?? "").trim();

    if (!courseName) return NextResponse.json({ error: "Course name is required" }, { status: 400 });
    if (!courseRating || courseRating < 50 || courseRating > 90) {
      return NextResponse.json({ error: "Course rating must be between 50 and 90" }, { status: 400 });
    }
    if (!slopeRating || slopeRating < 55 || slopeRating > 155) {
      return NextResponse.json({ error: "Slope rating must be between 55 and 155" }, { status: 400 });
    }
    if (!playedAt) return NextResponse.json({ error: "Date played is required" }, { status: 400 });

    // Validate played_at is within challenge window
    const challengeCreated = challenge.created_at.split("T")[0];
    if (playedAt < challengeCreated || playedAt > challenge.deadline) {
      return NextResponse.json(
        { error: `Round must be played between ${challengeCreated} and ${challenge.deadline}` },
        { status: 400 }
      );
    }

    const { data: round, error: insErr } = await admin
      .from("ladder_rounds")
      .insert({
        challenge_id: challengeId,
        user_id: user.id,
        course_name: courseName,
        tee_name: teeName,
        gross_score: null,
        course_rating: courseRating,
        slope_rating: slopeRating,
        par,
        differential: null,
        played_at: playedAt,
        completed: false,
      })
      .select("*")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ round });
  } catch (e: any) {
    console.error("ladder round create error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
