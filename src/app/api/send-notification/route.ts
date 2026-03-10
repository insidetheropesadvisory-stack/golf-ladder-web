import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

async function createInAppNotification(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  message: string,
  matchId?: string
) {
  await admin.from("notifications").insert({
    user_id: userId,
    message,
    match_id: matchId || null,
    read: false,
  });
}

export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const type = String(body.type ?? "").trim();

    const admin = adminClient();

    // --- Type: scoring_complete ---
    if (type === "scoring_complete") {
      const matchId = String(body.matchId ?? "").trim();
      if (!matchId) {
        return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
      }

      const { data: match } = await admin
        .from("matches")
        .select("id, creator_id, opponent_id, course_name, is_ladder_match")
        .eq("id", matchId)
        .single();

      if (!match) {
        return NextResponse.json({ error: "Match not found" }, { status: 404 });
      }

      const recipientId =
        user.id === match.creator_id ? match.opponent_id : match.creator_id;

      if (!recipientId) {
        return NextResponse.json({ error: "No opponent to notify" }, { status: 400 });
      }

      const { data: senderProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const senderName = senderProfile?.display_name || "Your opponent";
      const courseName = match.course_name || "Golf Match";

      const inAppMsg = `${senderName} finished scoring at ${courseName} — your turn!`;
      await createInAppNotification(admin, recipientId, inAppMsg, matchId);

      sendPushToUser(recipientId, {
        title: "Scores are in",
        body: inAppMsg,
        url: `/matches/${matchId}`,
        matchId,
      }).catch(() => {});

      return NextResponse.json({ ok: true });
    }

    // --- Type: pending_reminder ---
    if (type === "pending_reminder") {
      const matchId = String(body.matchId ?? "").trim();
      if (!matchId) {
        return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
      }

      const { data: match } = await admin
        .from("matches")
        .select("id, creator_id, opponent_id, course_name, is_ladder_match, status, terms_status")
        .eq("id", matchId)
        .single();

      if (!match) {
        return NextResponse.json({ error: "Match not found" }, { status: 404 });
      }

      if (user.id !== match.creator_id) {
        return NextResponse.json({ error: "Only the challenger can send a reminder" }, { status: 403 });
      }

      if (match.status !== "proposed" && match.terms_status !== "pending") {
        return NextResponse.json({ error: "Match is not pending" }, { status: 400 });
      }

      const { data: senderProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const senderName = senderProfile?.display_name || "A player";
      const courseName = match.course_name || "Golf Match";
      const ladderLabel = match.is_ladder_match ? " (Ladder)" : "";

      const oppId = match.opponent_id;
      const inAppMsg = `${senderName} is waiting for your response — ${courseName}${ladderLabel}`;
      if (oppId) {
        await createInAppNotification(admin, oppId, inAppMsg, matchId);

        sendPushToUser(oppId, {
          title: "Pending challenge",
          body: inAppMsg,
          url: `/matches/${matchId}`,
          matchId,
        }).catch(() => {});
      }

      return NextResponse.json({ ok: true });
    }

    // --- Type: dispute ---
    if (type === "dispute") {
      const matchId = String(body.matchId ?? "").trim();
      const reason = String(body.reason ?? "").trim();
      if (!matchId) {
        return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
      }
      if (!reason) {
        return NextResponse.json({ error: "Missing dispute reason" }, { status: 400 });
      }

      const { data: match } = await admin
        .from("matches")
        .select("id, creator_id, opponent_id, course_name")
        .eq("id", matchId)
        .single();

      if (!match) {
        return NextResponse.json({ error: "Match not found" }, { status: 404 });
      }

      // Verify caller is a participant
      if (user.id !== match.creator_id && user.id !== match.opponent_id) {
        return NextResponse.json({ error: "Not a participant" }, { status: 403 });
      }

      const { data: senderProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const senderName = senderProfile?.display_name || "A player";
      const courseName = match.course_name || "a match";

      // Notify the opponent
      const opponentId = user.id === match.creator_id ? match.opponent_id : match.creator_id;
      if (opponentId) {
        const oppMsg = `${senderName} has disputed your match at ${courseName}: "${reason}"`;
        await createInAppNotification(admin, opponentId, oppMsg, matchId);
        sendPushToUser(opponentId, {
          title: "Match disputed",
          body: oppMsg,
          url: `/matches/${matchId}`,
          matchId,
        }).catch(() => {});
      }

      // Notify platform admin
      const adminUserId = process.env.ADMIN_USER_ID;
      if (adminUserId) {
        const adminMsg = `⚠ DISPUTE: ${senderName} flagged match at ${courseName} — "${reason}" (match: ${matchId})`;
        await createInAppNotification(admin, adminUserId, adminMsg, matchId);
        sendPushToUser(adminUserId, {
          title: "Match dispute filed",
          body: adminMsg,
          url: `/matches/${matchId}`,
          matchId,
        }).catch(() => {});
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
  } catch (e: any) {
    console.error("send-notification error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
