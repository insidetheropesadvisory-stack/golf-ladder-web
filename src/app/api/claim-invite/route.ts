import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as any;
    const matchId = typeof body?.matchId === "string" ? body.matchId.trim() : "";
    const action = typeof body?.action === "string" ? body.action.trim() : "accept";

    if (!matchId) {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
    }

    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const admin = adminClient();

    // Fetch the match
    const { data: match, error: matchErr } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, opponent_email, status, terms_status, is_ladder_match")
      .eq("id", matchId)
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // Can't claim your own match
    if (match.creator_id === user.id) {
      return NextResponse.json(
        { error: "You created this match — you can't accept your own challenge" },
        { status: 403 }
      );
    }

    // Check if match is claimable (pending invite, no opponent_id set yet OR opponent matches)
    const isPending = match.terms_status === "pending" || match.status === "proposed";
    if (!isPending) {
      return NextResponse.json(
        { error: "This match is no longer pending" },
        { status: 403 }
      );
    }

    // If opponent_id is already set and it's not this user, reject
    if (match.opponent_id && match.opponent_id !== user.id) {
      return NextResponse.json(
        { error: "This invite has already been claimed by another player" },
        { status: 403 }
      );
    }

    // If opponent_email is set but doesn't match, check if opponent_id is null (open invite)
    const userEmail = (user.email ?? "").trim().toLowerCase();
    const matchEmail = (match.opponent_email ?? "").trim().toLowerCase();
    const isOpenInvite = !match.opponent_id && !matchEmail;
    const isEmailMatch = matchEmail && matchEmail === userEmail;
    const isIdMatch = match.opponent_id === user.id;

    if (!isOpenInvite && !isEmailMatch && !isIdMatch) {
      // Allow claiming if opponent_id is null (link-based invite)
      if (match.opponent_id) {
        return NextResponse.json(
          { error: "This invite is for a different player" },
          { status: 403 }
        );
      }
    }

    if (action === "decline") {
      // For link-based invites, declining just means not accepting — no ladder swap
      return NextResponse.json({ ok: true, declined: true });
    }

    // Claim the match: set opponent_id, status to active
    const { error: updateErr } = await admin
      .from("matches")
      .update({
        opponent_id: user.id,
        opponent_email: user.email ?? match.opponent_email,
        terms_status: "accepted",
        status: "active",
      })
      .eq("id", matchId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Create notification for the match creator
    try {
      const { data: claimerProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

      const claimerName = (claimerProfile as any)?.display_name || user.email || "Someone";

      const notifMsg = `${claimerName} accepted your match invite!`;
      await admin.from("notifications").insert({
        user_id: match.creator_id,
        message: notifMsg,
        match_id: matchId,
        read: false,
      });

      // Push notification (best-effort)
      await sendPushToUser(match.creator_id, {
        title: "Invite accepted!",
        body: notifMsg,
        url: `/matches/${matchId}`,
        matchId,
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({ ok: true, matchId });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
