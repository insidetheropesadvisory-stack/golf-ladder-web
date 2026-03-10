import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: clubId } = await params;
    if (!clubId) {
      return NextResponse.json({ error: "Missing club ID" }, { status: 400 });
    }

    const admin = adminClient();

    // Fetch club info
    const { data: club, error: clubErr } = await admin
      .from("clubs")
      .select("id, name, city, state, logo_url")
      .eq("id", clubId)
      .single();

    if (clubErr || !club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    // Fetch members with profiles
    const { data: memberships } = await admin
      .from("club_memberships")
      .select("user_id, guest_fee")
      .eq("club_id", clubId);

    const memberIds = (memberships ?? []).map((m: any) => m.user_id);
    const feeMap: Record<string, number | null> = {};
    for (const m of (memberships ?? []) as any[]) {
      feeMap[m.user_id] = m.guest_fee ?? null;
    }

    let members: any[] = [];
    if (memberIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, display_name, avatar_url, handicap_index")
        .in("id", memberIds);

      members = (profiles ?? []).map((p: any) => ({
        id: p.id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        handicap_index: p.handicap_index,
        guest_fee: feeMap[p.id] ?? null,
      }));

      // Sort by handicap (lowest first), nulls last
      members.sort((a: any, b: any) => {
        if (a.handicap_index == null && b.handicap_index == null) return 0;
        if (a.handicap_index == null) return 1;
        if (b.handicap_index == null) return -1;
        return a.handicap_index - b.handicap_index;
      });
    }

    // Fetch upcoming matches at this club's course
    const { data: upcomingMatches } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, opponent_email, course_name, round_time, format, use_handicap, is_ladder_match, status, terms_status, completed")
      .ilike("course_name", club.name)
      .eq("completed", false)
      .order("round_time", { ascending: true })
      .limit(10);

    // Fetch completed matches at this club for leaderboard
    const { data: completedMatches } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, format")
      .ilike("course_name", club.name)
      .eq("completed", true);

    const completedIds = (completedMatches ?? []).map((m: any) => m.id);

    // Build W/L leaderboard from completed matches
    const wlMap: Record<string, { wins: number; losses: number; played: number }> = {};

    if (completedIds.length > 0) {
      const { data: holes } = await admin
        .from("holes")
        .select("match_id, hole_no, player_id, strokes")
        .in("match_id", completedIds);

      const holesByMatch = new Map<string, any[]>();
      for (const h of (holes ?? []) as any[]) {
        const arr = holesByMatch.get(h.match_id) ?? [];
        arr.push(h);
        holesByMatch.set(h.match_id, arr);
      }

      for (const m of (completedMatches ?? []) as any[]) {
        const mHoles = holesByMatch.get(m.id) ?? [];
        const p1 = m.creator_id;
        const p2 = m.opponent_id;
        if (!p1 || !p2) continue;

        let p1Total = 0, p2Total = 0, p1Count = 0, p2Count = 0;
        for (const h of mHoles) {
          if (h.strokes == null) continue;
          if (h.player_id === p1) { p1Total += h.strokes; p1Count++; }
          else if (h.player_id === p2) { p2Total += h.strokes; p2Count++; }
        }
        if (p1Count === 0 || p2Count === 0) continue;

        // Only count members of this club
        const p1IsMember = memberIds.includes(p1);
        const p2IsMember = memberIds.includes(p2);

        let winner: string | null = null;
        let loser: string | null = null;

        if (m.format === "match_play") {
          let p1Holes = 0, p2Holes = 0;
          for (let h = 1; h <= 18; h++) {
            const s1 = mHoles.find((r: any) => r.player_id === p1 && r.hole_no === h)?.strokes;
            const s2 = mHoles.find((r: any) => r.player_id === p2 && r.hole_no === h)?.strokes;
            if (s1 == null || s2 == null) continue;
            if (s1 < s2) p1Holes++;
            else if (s2 < s1) p2Holes++;
          }
          if (p1Holes > p2Holes) { winner = p1; loser = p2; }
          else if (p2Holes > p1Holes) { winner = p2; loser = p1; }
        } else {
          if (p1Total < p2Total) { winner = p1; loser = p2; }
          else if (p2Total < p1Total) { winner = p2; loser = p1; }
        }

        for (const pid of [p1, p2]) {
          if (!memberIds.includes(pid)) continue;
          if (!wlMap[pid]) wlMap[pid] = { wins: 0, losses: 0, played: 0 };
          wlMap[pid].played++;
          if (pid === winner) wlMap[pid].wins++;
          else if (pid === loser) wlMap[pid].losses++;
        }
      }
    }

    // Build leaderboard sorted by wins desc
    const leaderboard = members
      .filter((m: any) => wlMap[m.id])
      .map((m: any) => ({
        ...m,
        wins: wlMap[m.id].wins,
        losses: wlMap[m.id].losses,
        played: wlMap[m.id].played,
      }))
      .sort((a: any, b: any) => b.wins - a.wins || a.losses - b.losses);

    // Get profile names for upcoming matches
    const upcomingPlayerIds = new Set<string>();
    for (const m of (upcomingMatches ?? []) as any[]) {
      if (m.creator_id) upcomingPlayerIds.add(m.creator_id);
      if (m.opponent_id) upcomingPlayerIds.add(m.opponent_id);
    }
    const playerNames: Record<string, string> = {};
    if (upcomingPlayerIds.size > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, display_name")
        .in("id", Array.from(upcomingPlayerIds));
      for (const p of (profs ?? []) as any[]) {
        playerNames[p.id] = p.display_name || "Unknown";
      }
    }

    const upcoming = (upcomingMatches ?? []).map((m: any) => ({
      id: m.id,
      creator_name: playerNames[m.creator_id] ?? "Unknown",
      opponent_name: m.opponent_id ? (playerNames[m.opponent_id] ?? "Unknown") : m.opponent_email,
      round_time: m.round_time,
      format: m.format,
      is_ladder_match: m.is_ladder_match,
      status: m.terms_status ?? m.status,
    }));

    return NextResponse.json({
      club,
      members,
      leaderboard,
      upcoming,
      memberCount: members.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
