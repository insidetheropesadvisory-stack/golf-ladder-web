import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function computePeriodNumber(
  startDate: string,
  periodType: string,
  playedAt: string
): number {
  const start = new Date(startDate + "T00:00:00");
  const played = new Date(playedAt + "T00:00:00");

  if (periodType === "weekly") {
    const diffMs = played.getTime() - start.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
  } else {
    return (
      (played.getFullYear() - start.getFullYear()) * 12 +
      (played.getMonth() - start.getMonth()) +
      1
    );
  }
}

const SUBMISSION_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: tournamentId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const admin = adminClient();

    // Verify user is an accepted participant
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

    // Get tournament for date validation
    const { data: tournament } = await admin
      .from("tournaments")
      .select("start_date, end_date, period_type, period_count, status")
      .eq("id", tournamentId)
      .single();

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.status === "completed") {
      return NextResponse.json({ error: "Tournament is completed" }, { status: 400 });
    }

    // Parse input
    const courseName = String(body.course_name ?? "").trim();
    const teeName = String(body.tee_name ?? "").trim() || null;
    const grossScore = Number(body.gross_score);
    const courseRating = Number(body.course_rating);
    const slopeRating = Number(body.slope_rating);
    const par = body.par != null ? Number(body.par) : null;
    const playedAt = String(body.played_at ?? "").trim();

    if (!courseName) return NextResponse.json({ error: "Course name is required" }, { status: 400 });
    if (!grossScore || grossScore < 40 || grossScore > 200) {
      return NextResponse.json({ error: "Gross score must be between 40 and 200" }, { status: 400 });
    }
    if (!courseRating || courseRating < 50 || courseRating > 90) {
      return NextResponse.json({ error: "Course rating must be between 50 and 90" }, { status: 400 });
    }
    if (!slopeRating || slopeRating < 55 || slopeRating > 155) {
      return NextResponse.json({ error: "Slope rating must be between 55 and 155" }, { status: 400 });
    }
    if (!playedAt) return NextResponse.json({ error: "Date played is required" }, { status: 400 });

    // Validate date is within tournament range
    if (playedAt < tournament.start_date || playedAt > tournament.end_date) {
      return NextResponse.json(
        { error: `Round must be played between ${tournament.start_date} and ${tournament.end_date}` },
        { status: 400 }
      );
    }

    // Enforce 12-hour submission window
    const playedDate = new Date(playedAt + "T23:59:59"); // end of day played
    const deadline = new Date(playedDate.getTime() + SUBMISSION_WINDOW_MS);
    const now = new Date();
    if (now > deadline) {
      return NextResponse.json(
        { error: "Submission window closed. Scores must be entered within 12 hours of the round date." },
        { status: 400 }
      );
    }

    // Compute period number
    const periodNumber = computePeriodNumber(
      tournament.start_date,
      tournament.period_type,
      playedAt
    );

    if (periodNumber < 1 || periodNumber > tournament.period_count) {
      return NextResponse.json({ error: "Round falls outside tournament periods" }, { status: 400 });
    }

    // Enforce 1 score per period — check for existing submission
    const { data: existing } = await admin
      .from("tournament_rounds")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("user_id", user.id)
      .eq("period_number", periodNumber)
      .maybeSingle();

    if (existing) {
      const unit = tournament.period_type === "weekly" ? "week" : "month";
      return NextResponse.json(
        { error: `You already submitted a score for ${unit} ${periodNumber}. Only one score per ${unit} is allowed.` },
        { status: 400 }
      );
    }

    // Compute differential: (113 / slope) * (gross - rating)
    const differential = Math.round(((113 / slopeRating) * (grossScore - courseRating)) * 10) / 10;

    const { data: round, error: insErr } = await admin
      .from("tournament_rounds")
      .insert({
        tournament_id: tournamentId,
        user_id: user.id,
        period_number: periodNumber,
        course_name: courseName,
        tee_name: teeName,
        gross_score: grossScore,
        course_rating: courseRating,
        slope_rating: slopeRating,
        par,
        differential,
        played_at: playedAt,
      })
      .select("*")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ round, period_number: periodNumber, differential });
  } catch (e: any) {
    console.error("tournament round error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
