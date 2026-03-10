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
    // monthly
    return (
      (played.getFullYear() - start.getFullYear()) * 12 +
      (played.getMonth() - start.getMonth()) +
      1
    );
  }
}

function getCurrentPeriod(
  startDate: string,
  periodType: string,
  periodCount: number
): number {
  const today = new Date().toISOString().split("T")[0];
  const p = computePeriodNumber(startDate, periodType, today);
  return Math.max(1, Math.min(p, periodCount));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: tournamentId } = await params;
    const admin = adminClient();

    // Fetch tournament
    const { data: tournament, error: tErr } = await admin
      .from("tournaments")
      .select("*")
      .eq("id", tournamentId)
      .single();

    if (tErr || !tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    // Fetch participants
    const { data: participants } = await admin
      .from("tournament_participants")
      .select("*")
      .eq("tournament_id", tournamentId);

    // Fetch profiles for participants
    const userIds = (participants ?? []).map((p: any) => p.user_id);
    const profiles: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: profData } = await admin
        .from("profiles")
        .select("id, display_name, avatar_url, handicap_index")
        .in("id", userIds);
      for (const p of (profData ?? []) as any[]) {
        profiles[String(p.id)] = p;
      }
    }

    // Fetch all rounds
    const { data: rounds } = await admin
      .from("tournament_rounds")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("played_at", { ascending: true });

    // Compute leaderboard (1 score per period per player)
    const acceptedUsers = (participants ?? [])
      .filter((p: any) => p.status === "accepted")
      .map((p: any) => p.user_id);

    // Map each player's score per period (only 1 allowed)
    const periodScores: Record<string, Record<number, { round_id: string; differential: number; gross_score: number; course_name: string }>> = {};
    for (const uid of acceptedUsers) {
      periodScores[uid] = {};
    }

    for (const r of (rounds ?? []) as any[]) {
      if (!periodScores[r.user_id]) continue;
      // Only count completed rounds in standings
      if (r.completed === false) continue;
      // Only 1 score per period — take the first (enforced by API)
      if (!periodScores[r.user_id][r.period_number]) {
        periodScores[r.user_id][r.period_number] = {
          round_id: r.id,
          differential: Number(r.differential),
          gross_score: r.gross_score,
          course_name: r.course_name,
        };
      }
    }

    // Overall standings: average differential across submitted periods
    const standings = acceptedUsers.map((uid: string) => {
      const scores = periodScores[uid];
      const periods = Object.keys(scores).map(Number);
      const diffs = periods.map((p) => scores[p].differential);
      const avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;

      return {
        user_id: uid,
        rounds_played: periods.length,
        periods_played: periods.length,
        avg_differential: avgDiff != null ? Math.round(avgDiff * 10) / 10 : null,
        period_scores: scores,
      };
    });

    // Sort: players with scores first (by avg_differential asc), then players with no scores
    standings.sort((a, b) => {
      if (a.avg_differential == null && b.avg_differential == null) return 0;
      if (a.avg_differential == null) return 1;
      if (b.avg_differential == null) return -1;
      return a.avg_differential - b.avg_differential;
    });

    // Period leaderboards
    const periodLeaderboards: Record<number, { user_id: string; round_id: string; differential: number; gross_score: number; course_name: string }[]> = {};
    for (let p = 1; p <= tournament.period_count; p++) {
      const entries: { user_id: string; round_id: string; differential: number; gross_score: number; course_name: string }[] = [];
      for (const uid of acceptedUsers) {
        const score = periodScores[uid]?.[p];
        if (score) entries.push({ user_id: uid, ...score });
      }
      entries.sort((a, b) => a.differential - b.differential);
      periodLeaderboards[p] = entries;
    }

    const currentPeriod = getCurrentPeriod(
      tournament.start_date,
      tournament.period_type,
      tournament.period_count
    );

    return NextResponse.json({
      tournament,
      participants: participants ?? [],
      profiles,
      rounds: rounds ?? [],
      standings,
      periodLeaderboards,
      currentPeriod,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
