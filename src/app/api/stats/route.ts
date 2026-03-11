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
};

type HoleRow = {
  match_id: string;
  hole_no: number;
  player_id: string;
  strokes: number | null;
};

export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const admin = adminClient();

    const uid = user.id;

    // Fetch all completed matches involving this user
    const { data: matches, error: mErr } = await admin
      .from("matches")
      .select("id,creator_id,opponent_id,course_name,format,use_handicap,is_ladder_match,completed")
      .eq("completed", true)
      .or(`creator_id.eq.${uid},opponent_id.eq.${uid}`);

    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 });
    }

    const matchRows = (matches ?? []) as MatchRow[];
    if (matchRows.length === 0) {
      return NextResponse.json({
        wins: 0, losses: 0, ties: 0,
        totalRounds: 0,
        avgScore: null,
        bestScore: null,
        headToHead: [],
        byCourse: [],
      });
    }

    const matchIds = matchRows.map((m) => m.id);

    // Fetch all holes for these matches
    const { data: holes, error: hErr } = await admin
      .from("holes")
      .select("match_id,hole_no,player_id,strokes")
      .in("match_id", matchIds);

    if (hErr) {
      return NextResponse.json({ error: hErr.message }, { status: 500 });
    }

    const holeRows = (holes ?? []) as HoleRow[];

    // Group holes by match
    const holesByMatch = new Map<string, HoleRow[]>();
    for (const h of holeRows) {
      const arr = holesByMatch.get(h.match_id) ?? [];
      arr.push(h);
      holesByMatch.set(h.match_id, arr);
    }

    // Compute per-match results
    let wins = 0, losses = 0, ties = 0;
    const h2hMap = new Map<string, { wins: number; losses: number; ties: number }>();
    const courseMap = new Map<string, { totalStrokes: number; scoredRounds: number; rounds: number; best: number | null }>();
    const allScores: number[] = [];

    for (const m of matchRows) {
      const mHoles = holesByMatch.get(m.id) ?? [];
      const oppId = m.creator_id === uid ? m.opponent_id : m.creator_id;
      if (!oppId) continue;

      // Sum strokes
      let myTotal = 0, oppTotal = 0;
      let myCount = 0, oppCount = 0;
      for (const h of mHoles) {
        if (h.strokes == null) continue;
        if (h.player_id === uid) { myTotal += h.strokes; myCount++; }
        else if (h.player_id === oppId) { oppTotal += h.strokes; oppCount++; }
      }

      if (myCount === 0) continue;

      // Track my score (only count rounds with 9+ holes)
      if (myCount >= 9) {
        allScores.push(myTotal);
        const courseEntry = courseMap.get(m.course_name) ?? { totalStrokes: 0, scoredRounds: 0, rounds: 0, best: null };
        courseEntry.totalStrokes += myTotal;
        courseEntry.scoredRounds++;
        courseEntry.rounds++;
        if (courseEntry.best === null || myTotal < courseEntry.best) courseEntry.best = myTotal;
        courseMap.set(m.course_name, courseEntry);
      }

      if (oppCount === 0) continue;

      // Determine winner
      let result: "win" | "loss" | "tie";
      if (m.format === "match_play") {
        let myHoles = 0, oppHoles = 0;
        for (let h = 1; h <= 18; h++) {
          const ms = mHoles.find((r) => r.player_id === uid && r.hole_no === h)?.strokes;
          const os = mHoles.find((r) => r.player_id === oppId && r.hole_no === h)?.strokes;
          if (ms == null || os == null) continue;
          if (ms < os) myHoles++;
          else if (os < ms) oppHoles++;
        }
        result = myHoles > oppHoles ? "win" : myHoles < oppHoles ? "loss" : "tie";
      } else {
        result = myTotal < oppTotal ? "win" : myTotal > oppTotal ? "loss" : "tie";
      }

      if (result === "win") wins++;
      else if (result === "loss") losses++;
      else ties++;

      // Head to head
      const h2h = h2hMap.get(oppId) ?? { wins: 0, losses: 0, ties: 0 };
      h2h[result === "win" ? "wins" : result === "loss" ? "losses" : "ties"]++;
      h2hMap.set(oppId, h2h);
    }

    // Fetch opponent names
    const oppIds = Array.from(h2hMap.keys());
    const oppNames: Record<string, string> = {};
    if (oppIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id,display_name")
        .in("id", oppIds);
      for (const p of (profiles ?? []) as any[]) {
        oppNames[p.id] = p.display_name || "Unknown";
      }
    }

    const headToHead = Array.from(h2hMap.entries())
      .map(([oppId, record]) => ({
        opponentId: oppId,
        opponentName: oppNames[oppId] ?? "Unknown",
        ...record,
        total: record.wins + record.losses + record.ties,
      }))
      .sort((a, b) => b.total - a.total);

    // --- Pool completed rounds ---
    let poolRounds = 0;

    // As creator
    const { data: createdPools } = await admin
      .from("pool_listings")
      .select("id, course_name")
      .eq("creator_id", uid)
      .eq("status", "completed");

    if (createdPools) {
      poolRounds += createdPools.length;
      for (const p of createdPools as any[]) {
        const entry = courseMap.get(p.course_name) ?? { totalStrokes: 0, scoredRounds: 0, rounds: 0, best: null };
        entry.rounds++;
        courseMap.set(p.course_name, entry);
      }
    }

    // As accepted guest
    const { data: guestApps } = await admin
      .from("pool_applications")
      .select("listing_id")
      .eq("applicant_id", uid)
      .eq("status", "accepted");

    if (guestApps && guestApps.length > 0) {
      const guestListingIds = (guestApps as any[]).map((a: any) => a.listing_id);
      const { data: guestPools } = await admin
        .from("pool_listings")
        .select("id, course_name")
        .in("id", guestListingIds)
        .eq("status", "completed");

      if (guestPools) {
        poolRounds += guestPools.length;
        for (const p of guestPools as any[]) {
          const entry = courseMap.get(p.course_name) ?? { totalStrokes: 0, scoredRounds: 0, rounds: 0, best: null };
          entry.rounds++;
          courseMap.set(p.course_name, entry);
        }
      }
    }

    const byCourse = Array.from(courseMap.entries())
      .map(([course, data]) => ({
        course,
        rounds: data.rounds,
        avgScore: data.scoredRounds > 0
          ? Math.round((data.totalStrokes / data.scoredRounds) * 10) / 10
          : null,
        bestScore: data.best,
      }))
      .sort((a, b) => b.rounds - a.rounds);

    const avgScore = allScores.length > 0
      ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
      : null;

    const bestScore = allScores.length > 0 ? Math.min(...allScores) : null;

    return NextResponse.json({
      wins, losses, ties,
      totalRounds: allScores.length + poolRounds,
      poolRounds,
      avgScore,
      bestScore,
      headToHead,
      byCourse,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
