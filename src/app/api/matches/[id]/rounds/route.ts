import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/matches/[id]/rounds
 * Fetch all rounds and holes for a different-courses match.
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

    const { id: matchId } = await params;
    const admin = adminClient();

    const { data: match } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id")
      .eq("id", matchId)
      .single();

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (match.creator_id !== user.id && match.opponent_id !== user.id) {
      return NextResponse.json({ error: "Not your match" }, { status: 403 });
    }

    const { data: rounds } = await admin
      .from("match_rounds")
      .select("*")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    const roundIds = (rounds ?? []).map((r: any) => r.id);

    let holes: any[] = [];
    if (roundIds.length > 0) {
      const { data: h } = await admin
        .from("match_holes")
        .select("*")
        .in("match_round_id", roundIds)
        .order("hole_no", { ascending: true });
      holes = h ?? [];
    }

    return NextResponse.json({ rounds: rounds ?? [], holes });
  } catch (e: any) {
    console.error("match rounds GET error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/matches/[id]/rounds
 * Create a round for the current user on a different-courses match.
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

    const { id: matchId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const admin = adminClient();

    // Verify match exists, user is participant, and mode is different_courses
    const { data: match } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, play_mode, status")
      .eq("id", matchId)
      .single();

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (match.creator_id !== user.id && match.opponent_id !== user.id) {
      return NextResponse.json({ error: "Not your match" }, { status: 403 });
    }

    if (match.play_mode !== "different_courses") {
      return NextResponse.json({ error: "This match does not use different-courses mode" }, { status: 400 });
    }

    // Check user hasn't already submitted a round
    const { data: existingRound } = await admin
      .from("match_rounds")
      .select("id")
      .eq("match_id", matchId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingRound) {
      return NextResponse.json({ error: "You already have a round for this match" }, { status: 400 });
    }

    // Validate input
    const courseName = String(body.course_name ?? "").trim();
    const teeName = String(body.tee_name ?? "").trim() || null;
    const courseRating = Number(body.course_rating);
    const slopeRating = Number(body.slope_rating);
    const par = body.par != null ? Number(body.par) : null;
    const playedAt = String(body.played_at ?? "").trim();
    const golfCourseApiId = body.golf_course_api_id != null ? Number(body.golf_course_api_id) : null;

    if (!courseName) {
      return NextResponse.json({ error: "Course name is required" }, { status: 400 });
    }
    if (!courseRating || courseRating < 50 || courseRating > 90) {
      return NextResponse.json({ error: "Course rating must be between 50 and 90" }, { status: 400 });
    }
    if (!slopeRating || slopeRating < 55 || slopeRating > 155) {
      return NextResponse.json({ error: "Slope rating must be between 55 and 155" }, { status: 400 });
    }
    if (!playedAt) {
      return NextResponse.json({ error: "Date played is required" }, { status: 400 });
    }

    const { data: round, error: insErr } = await admin
      .from("match_rounds")
      .insert({
        match_id: matchId,
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
        golf_course_api_id: golfCourseApiId,
      })
      .select("*")
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ round });
  } catch (e: any) {
    console.error("match round create error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
