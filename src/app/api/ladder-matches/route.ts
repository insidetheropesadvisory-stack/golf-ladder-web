import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

/**
 * GET /api/ladder-matches
 * List challenges for the current user (as challenger or opponent).
 */
export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const admin = adminClient();

    const { data: challenges, error: qErr } = await admin
      .from("ladder_challenges")
      .select("*")
      .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

    // Gather profiles
    const userIds = new Set<string>();
    for (const c of challenges ?? []) {
      userIds.add(c.challenger_id);
      userIds.add(c.opponent_id);
    }

    let profiles: Record<string, any> = {};
    if (userIds.size > 0) {
      const { data: profData } = await admin
        .from("profiles")
        .select("id, display_name, avatar_url, handicap_index")
        .in("id", [...userIds]);
      if (profData) {
        for (const p of profData) profiles[p.id] = p;
      }
    }

    // Gather rounds for these challenges
    const challengeIds = (challenges ?? []).map((c: any) => c.id);
    let rounds: Record<string, any[]> = {};
    if (challengeIds.length > 0) {
      const { data: roundData } = await admin
        .from("ladder_rounds")
        .select("id, challenge_id, user_id, course_name, completed, differential, gross_score")
        .in("challenge_id", challengeIds);
      if (roundData) {
        for (const r of roundData) {
          if (!rounds[r.challenge_id]) rounds[r.challenge_id] = [];
          rounds[r.challenge_id].push(r);
        }
      }
    }

    return NextResponse.json({ challenges: challenges ?? [], profiles, rounds });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/ladder-matches
 * Actions: create, accept, decline, counter
 */
export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const action = String(body.action ?? "").trim();
    const admin = adminClient();

    // ---- CREATE ----
    if (action === "create") {
      const opponentId = String(body.opponent_id ?? "").trim();
      const deadline = String(body.deadline ?? "").trim();

      if (!opponentId) return NextResponse.json({ error: "Missing opponent_id" }, { status: 400 });
      if (!deadline) return NextResponse.json({ error: "Missing deadline" }, { status: 400 });
      if (opponentId === user.id) return NextResponse.json({ error: "Cannot challenge yourself" }, { status: 400 });

      // Validate deadline (max 14 days from now)
      const deadlineDate = new Date(deadline + "T23:59:59");
      const maxDeadline = new Date();
      maxDeadline.setDate(maxDeadline.getDate() + 14);
      if (deadlineDate > maxDeadline) {
        return NextResponse.json({ error: "Deadline cannot be more than 14 days from now" }, { status: 400 });
      }
      if (deadlineDate < new Date()) {
        return NextResponse.json({ error: "Deadline must be in the future" }, { status: 400 });
      }

      // Check neither player has an active challenge
      const { data: activeChallenges } = await admin
        .from("ladder_challenges")
        .select("id")
        .in("status", ["pending", "accepted"])
        .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id},challenger_id.eq.${opponentId},opponent_id.eq.${opponentId}`);

      if (activeChallenges && activeChallenges.length > 0) {
        return NextResponse.json(
          { error: "One of the players already has an active ladder challenge" },
          { status: 400 }
        );
      }

      // Verify both players are in the ladder
      const { data: rankings } = await admin
        .from("ladder_rankings")
        .select("user_id, position")
        .eq("type", "gross")
        .in("user_id", [user.id, opponentId]);

      if (!rankings || rankings.length < 2) {
        return NextResponse.json({ error: "Both players must be in the ladder" }, { status: 400 });
      }

      const myRank = rankings.find((r: any) => r.user_id === user.id);
      const oppRank = rankings.find((r: any) => r.user_id === opponentId);

      if (!myRank || !oppRank) {
        return NextResponse.json({ error: "Players not found in ladder" }, { status: 400 });
      }

      // Can only challenge up to 3 spots above
      if (myRank.position <= oppRank.position) {
        return NextResponse.json({ error: "You can only challenge players ranked above you" }, { status: 400 });
      }
      if (myRank.position - oppRank.position > 3) {
        return NextResponse.json({ error: "You can only challenge players up to 3 spots above you" }, { status: 400 });
      }

      const { data: challenge, error: insErr } = await admin
        .from("ladder_challenges")
        .insert({
          challenger_id: user.id,
          opponent_id: opponentId,
          status: "pending",
          deadline,
        })
        .select("*")
        .single();

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

      // Notify opponent
      const { data: myProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const challengerName = myProfile?.display_name || "Someone";

      await admin.from("notifications").insert({
        user_id: opponentId,
        message: `${challengerName} challenged you on the ladder! Deadline: ${deadline}`,
        read: false,
      });

      sendPushToUser(opponentId, {
        title: "Ladder Challenge!",
        body: `${challengerName} challenged you! Deadline: ${deadline}`,
        url: `/ladder/challenge/${challenge.id}`,
      }).catch(() => {});

      return NextResponse.json({ challenge });
    }

    // ---- ACCEPT ----
    if (action === "accept") {
      const challengeId = String(body.challenge_id ?? "").trim();
      if (!challengeId) return NextResponse.json({ error: "Missing challenge_id" }, { status: 400 });

      const { data: challenge } = await admin
        .from("ladder_challenges")
        .select("*")
        .eq("id", challengeId)
        .single();

      if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
      if (challenge.opponent_id !== user.id) {
        return NextResponse.json({ error: "Only the opponent can accept" }, { status: 403 });
      }
      if (challenge.status !== "pending") {
        return NextResponse.json({ error: "Challenge is not pending" }, { status: 400 });
      }

      await admin
        .from("ladder_challenges")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", challengeId);

      // Notify challenger
      const { data: myProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      await admin.from("notifications").insert({
        user_id: challenge.challenger_id,
        message: `${myProfile?.display_name || "Your opponent"} accepted your ladder challenge!`,
        read: false,
      });

      sendPushToUser(challenge.challenger_id, {
        title: "Challenge Accepted!",
        body: `${myProfile?.display_name || "Your opponent"} accepted your ladder challenge!`,
        url: `/ladder/challenge/${challengeId}`,
      }).catch(() => {});

      return NextResponse.json({ ok: true });
    }

    // ---- DECLINE ----
    if (action === "decline") {
      const challengeId = String(body.challenge_id ?? "").trim();
      if (!challengeId) return NextResponse.json({ error: "Missing challenge_id" }, { status: 400 });

      const { data: challenge } = await admin
        .from("ladder_challenges")
        .select("*")
        .eq("id", challengeId)
        .single();

      if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
      if (challenge.opponent_id !== user.id) {
        return NextResponse.json({ error: "Only the opponent can decline" }, { status: 403 });
      }
      if (challenge.status !== "pending") {
        return NextResponse.json({ error: "Challenge is not pending" }, { status: 400 });
      }

      await admin
        .from("ladder_challenges")
        .update({ status: "declined", updated_at: new Date().toISOString() })
        .eq("id", challengeId);

      // Decline penalty: challenger takes decliner's spot, decliner drops 1
      for (const ladderType of ["gross", "net"]) {
        const { data: positions } = await admin
          .from("ladder_rankings")
          .select("id, user_id, position")
          .eq("type", ladderType)
          .in("user_id", [challenge.challenger_id, challenge.opponent_id]);

        if (!positions || positions.length < 2) continue;

        const challengerRow = positions.find((p: any) => p.user_id === challenge.challenger_id);
        const declinerRow = positions.find((p: any) => p.user_id === challenge.opponent_id);

        if (challengerRow && declinerRow && challengerRow.position > declinerRow.position) {
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
      }

      // Notify challenger
      const { data: myProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      await admin.from("notifications").insert({
        user_id: challenge.challenger_id,
        message: `${myProfile?.display_name || "Your opponent"} declined your ladder challenge. You've been moved up!`,
        read: false,
      });

      sendPushToUser(challenge.challenger_id, {
        title: "Challenge Declined",
        body: `${myProfile?.display_name || "Your opponent"} declined. You've moved up on the ladder!`,
        url: "/ladder",
      }).catch(() => {});

      return NextResponse.json({ ok: true });
    }

    // ---- COUNTER (request deadline change) ----
    if (action === "counter") {
      const challengeId = String(body.challenge_id ?? "").trim();
      const newDeadline = String(body.deadline ?? "").trim();
      if (!challengeId) return NextResponse.json({ error: "Missing challenge_id" }, { status: 400 });
      if (!newDeadline) return NextResponse.json({ error: "Missing deadline" }, { status: 400 });

      const { data: challenge } = await admin
        .from("ladder_challenges")
        .select("*")
        .eq("id", challengeId)
        .single();

      if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
      if (challenge.opponent_id !== user.id) {
        return NextResponse.json({ error: "Only the opponent can counter" }, { status: 403 });
      }
      if (challenge.status !== "pending") {
        return NextResponse.json({ error: "Challenge is not pending" }, { status: 400 });
      }

      // Validate new deadline
      const deadlineDate = new Date(newDeadline + "T23:59:59");
      const maxDeadline = new Date();
      maxDeadline.setDate(maxDeadline.getDate() + 14);
      if (deadlineDate > maxDeadline) {
        return NextResponse.json({ error: "Deadline cannot be more than 14 days from now" }, { status: 400 });
      }
      if (deadlineDate < new Date()) {
        return NextResponse.json({ error: "Deadline must be in the future" }, { status: 400 });
      }

      await admin
        .from("ladder_challenges")
        .update({ deadline: newDeadline, updated_at: new Date().toISOString() })
        .eq("id", challengeId);

      // Notify challenger about the counter
      const { data: myProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      await admin.from("notifications").insert({
        user_id: challenge.challenger_id,
        message: `${myProfile?.display_name || "Your opponent"} requested a new deadline: ${newDeadline}`,
        read: false,
      });

      sendPushToUser(challenge.challenger_id, {
        title: "Deadline Change Requested",
        body: `${myProfile?.display_name || "Your opponent"} wants to change the deadline to ${newDeadline}`,
        url: `/ladder/challenge/${challengeId}`,
      }).catch(() => {});

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("ladder-matches error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
