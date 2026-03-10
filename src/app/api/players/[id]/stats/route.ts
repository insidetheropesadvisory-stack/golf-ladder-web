import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MatchRow = {
  id: string;
  creator_id: string;
  opponent_id: string | null;
  course_name: string;
  format: string;
  use_handicap: boolean;
  is_ladder_match: boolean;
  completed: boolean;
  created_at: string;
  round_time: string | null;
};

type HoleRow = {
  match_id: string;
  hole_no: number;
  player_id: string;
  strokes: number | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: targetId } = await params;
    const meId = user.id;
    const admin = adminClient();

    // Fetch target player profile
    const { data: targetProfile } = await admin
      .from("profiles")
      .select("id, display_name, avatar_url, handicap_index, email")
      .eq("id", targetId)
      .maybeSingle();

    if (!targetProfile) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    // Fetch target player's club memberships
    const { data: memberships } = await admin
      .from("club_memberships")
      .select("clubs(id, name)")
      .eq("user_id", targetId);

    const clubs = (memberships ?? [])
      .map((m: any) => m.clubs)
      .filter(Boolean)
      .map((c: any) => ({ id: c.id, name: c.name }));

    // Fetch all completed matches between me and this player
    const { data: matches } = await admin
      .from("matches")
      .select(
        "id, creator_id, opponent_id, course_name, format, use_handicap, is_ladder_match, completed, created_at, round_time"
      )
      .eq("completed", true)
      .or(
        `and(creator_id.eq.${meId},opponent_id.eq.${targetId}),and(creator_id.eq.${targetId},opponent_id.eq.${meId})`
      )
      .order("created_at", { ascending: false });

    const matchRows = (matches ?? []) as MatchRow[];

    if (matchRows.length === 0) {
      return NextResponse.json({
        profile: targetProfile,
        clubs,
        h2h: { wins: 0, losses: 0, ties: 0, total: 0 },
        matches: [],
      });
    }

    // Fetch all holes for these matches
    const matchIds = matchRows.map((m) => m.id);
    const { data: holes } = await admin
      .from("holes")
      .select("match_id, hole_no, player_id, strokes")
      .in("match_id", matchIds);

    const holeRows = (holes ?? []) as HoleRow[];
    const holesByMatch = new Map<string, HoleRow[]>();
    for (const h of holeRows) {
      const arr = holesByMatch.get(h.match_id) ?? [];
      arr.push(h);
      holesByMatch.set(h.match_id, arr);
    }

    let wins = 0,
      losses = 0,
      ties = 0;

    const matchSummaries = matchRows.map((m) => {
      const mHoles = holesByMatch.get(m.id) ?? [];

      let myTotal = 0,
        oppTotal = 0,
        myCount = 0,
        oppCount = 0;
      for (const h of mHoles) {
        if (h.strokes == null) continue;
        if (h.player_id === meId) {
          myTotal += h.strokes;
          myCount++;
        } else if (h.player_id === targetId) {
          oppTotal += h.strokes;
          oppCount++;
        }
      }

      let result: "win" | "loss" | "tie" = "tie";
      let myHolesWon = 0,
        oppHolesWon = 0;

      if (myCount > 0 && oppCount > 0) {
        if (m.format === "match_play") {
          for (let h = 1; h <= 18; h++) {
            const ms = mHoles.find(
              (r) => r.player_id === meId && r.hole_no === h
            )?.strokes;
            const os = mHoles.find(
              (r) => r.player_id === targetId && r.hole_no === h
            )?.strokes;
            if (ms == null || os == null) continue;
            if (ms < os) myHolesWon++;
            else if (os < ms) oppHolesWon++;
          }
          result =
            myHolesWon > oppHolesWon
              ? "win"
              : myHolesWon < oppHolesWon
              ? "loss"
              : "tie";
        } else {
          result =
            myTotal < oppTotal
              ? "win"
              : myTotal > oppTotal
              ? "loss"
              : "tie";
        }
      }

      if (result === "win") wins++;
      else if (result === "loss") losses++;
      else ties++;

      return {
        id: m.id,
        course_name: m.course_name,
        format: m.format,
        use_handicap: m.use_handicap,
        is_ladder_match: m.is_ladder_match,
        created_at: m.created_at,
        round_time: m.round_time,
        result,
        myScore: myCount > 0 ? myTotal : null,
        oppScore: oppCount > 0 ? oppTotal : null,
        myHolesWon: m.format === "match_play" ? myHolesWon : undefined,
        oppHolesWon: m.format === "match_play" ? oppHolesWon : undefined,
      };
    });

    return NextResponse.json({
      profile: targetProfile,
      clubs,
      h2h: { wins, losses, ties, total: wins + losses + ties },
      matches: matchSummaries,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
