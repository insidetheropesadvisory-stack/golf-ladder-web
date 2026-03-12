import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const admin = adminClient();

    // Fetch all ladder rankings with profiles
    const { data: rankings, error: rankErr } = await admin
      .from("ladder_rankings")
      .select("id, user_id, position, type, updated_at")
      .order("position", { ascending: true });

    if (rankErr) {
      return NextResponse.json({ error: rankErr.message }, { status: 500 });
    }

    // Fetch profiles for all ranked users
    const userIds = [...new Set((rankings ?? []).map((r: any) => r.user_id))];
    let profiles: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: profData } = await admin
        .from("profiles")
        .select("id, display_name, avatar_url, handicap_index")
        .in("id", userIds);
      if (profData) {
        for (const p of profData as any[]) {
          profiles[String(p.id)] = p;
        }
      }
    }

    // Fetch W-L records from ladder_challenges
    const { data: challenges } = await admin
      .from("ladder_challenges")
      .select("challenger_id, opponent_id, winner_id, status")
      .eq("status", "completed");

    const records: Record<string, { wins: number; losses: number }> = {};
    for (const c of (challenges ?? []) as any[]) {
      if (!records[c.challenger_id]) records[c.challenger_id] = { wins: 0, losses: 0 };
      if (!records[c.opponent_id]) records[c.opponent_id] = { wins: 0, losses: 0 };

      if (c.winner_id === c.challenger_id) {
        records[c.challenger_id].wins++;
        records[c.opponent_id].losses++;
      } else if (c.winner_id === c.opponent_id) {
        records[c.opponent_id].wins++;
        records[c.challenger_id].losses++;
      }
      // Ties: no W or L
    }

    return NextResponse.json({
      rankings: rankings ?? [],
      profiles,
      records,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as any;
    const action = String(body.action ?? "").trim();

    const admin = adminClient();

    // ---- ACTION: init ----
    // Initialize ladder from handicap rankings (admin/first-time setup)
    if (action === "init") {
      // Get all profiles with handicap, ordered
      const { data: allProfiles, error: profErr } = await admin
        .from("profiles")
        .select("id, handicap_index")
        .not("display_name", "is", null)
        .order("handicap_index", { ascending: true, nullsFirst: false });

      if (profErr) {
        return NextResponse.json({ error: profErr.message }, { status: 500 });
      }

      const withHcp = (allProfiles ?? []).filter((p: any) => p.handicap_index != null);
      const noHcp = (allProfiles ?? []).filter((p: any) => p.handicap_index == null);
      const ordered = [...withHcp, ...noHcp];

      // Clear existing rankings
      await admin.from("ladder_rankings").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      // Insert new rankings for both net and gross
      const now = new Date().toISOString();
      const rows = ordered.flatMap((p: any, i: number) => [
        { user_id: p.id, position: i + 1, type: "net", updated_at: now },
        { user_id: p.id, position: i + 1, type: "gross", updated_at: now },
      ]);

      if (rows.length > 0) {
        const { error: insErr } = await admin.from("ladder_rankings").insert(rows);
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true, count: ordered.length });
    }

    // ---- ACTION: swap (on match completion or decline) ----
    if (action === "swap") {
      const winnerId = String(body.winnerId ?? "").trim();
      const loserId = String(body.loserId ?? "").trim();
      const ladderType = String(body.type ?? "gross").trim();

      if (!winnerId || !loserId) {
        return NextResponse.json({ error: "Missing winnerId/loserId" }, { status: 400 });
      }

      // Get both positions
      const { data: positions } = await admin
        .from("ladder_rankings")
        .select("id, user_id, position")
        .eq("type", ladderType)
        .in("user_id", [winnerId, loserId]);

      if (!positions || positions.length < 2) {
        return NextResponse.json({ error: "Players not found in ladder" }, { status: 404 });
      }

      const winnerRow = positions.find((p: any) => p.user_id === winnerId);
      const loserRow = positions.find((p: any) => p.user_id === loserId);

      if (!winnerRow || !loserRow) {
        return NextResponse.json({ error: "Players not found" }, { status: 404 });
      }

      // Only swap if the winner was ranked lower (higher number) than the loser
      if (winnerRow.position > loserRow.position) {
        const now = new Date().toISOString();
        await admin
          .from("ladder_rankings")
          .update({ position: loserRow.position, updated_at: now })
          .eq("id", winnerRow.id);
        await admin
          .from("ladder_rankings")
          .update({ position: winnerRow.position, updated_at: now })
          .eq("id", loserRow.id);
      }

      return NextResponse.json({ ok: true });
    }

    // ---- ACTION: decline-swap (challenger takes spot on decline) ----
    if (action === "decline-swap") {
      const challengerId = String(body.challengerId ?? "").trim();
      const declinerId = String(body.declinerId ?? "").trim();
      const ladderType = String(body.type ?? "gross").trim();

      if (!challengerId || !declinerId) {
        return NextResponse.json({ error: "Missing challengerId/declinerId" }, { status: 400 });
      }

      const { data: positions } = await admin
        .from("ladder_rankings")
        .select("id, user_id, position")
        .eq("type", ladderType)
        .in("user_id", [challengerId, declinerId]);

      if (!positions || positions.length < 2) {
        return NextResponse.json({ error: "Players not found in ladder" }, { status: 404 });
      }

      const challengerRow = positions.find((p: any) => p.user_id === challengerId);
      const declinerRow = positions.find((p: any) => p.user_id === declinerId);

      if (!challengerRow || !declinerRow) {
        return NextResponse.json({ error: "Players not found" }, { status: 404 });
      }

      // Only swap if challenger was below decliner
      if (challengerRow.position > declinerRow.position) {
        const now = new Date().toISOString();
        await admin
          .from("ladder_rankings")
          .update({ position: declinerRow.position, updated_at: now })
          .eq("id", challengerRow.id);
        await admin
          .from("ladder_rankings")
          .update({ position: challengerRow.position, updated_at: now })
          .eq("id", declinerRow.id);
      }

      return NextResponse.json({ ok: true });
    }

    // ---- ACTION: join (add user to ladder) ----
    if (action === "join") {
      // Check if already in ladder
      const { data: existing } = await admin
        .from("ladder_rankings")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", "gross")
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ ok: true, message: "Already in ladder" });
      }

      // Get last position
      const { data: lastRow } = await admin
        .from("ladder_rankings")
        .select("position")
        .eq("type", "gross")
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextPos = (lastRow?.position ?? 0) + 1;
      const now = new Date().toISOString();

      const { error: insErr } = await admin.from("ladder_rankings").insert([
        { user_id: user.id, position: nextPos, type: "net", updated_at: now },
        { user_id: user.id, position: nextPos, type: "gross", updated_at: now },
      ]);

      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, position: nextPos });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("ladder error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
