import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as any;
    const matchId =
      typeof body?.matchId === "string" ? body.matchId.trim() : "";
    const action = typeof body?.action === "string" ? body.action.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const opponentTee = typeof body?.opponent_tee === "string" ? body.opponent_tee.trim() : null;

    if (!matchId) {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
    }

    if (action !== "accept" && action !== "decline") {
      return NextResponse.json(
        { error: "action must be \"accept\" or \"decline\"" },
        { status: 400 }
      );
    }

    const { user, error: userErr } = await getAuthedUser(request);

    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const supabaseAdmin = adminClient();

    // Fetch match
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("id, creator_id, opponent_id, status, terms_status, opponent_email, course_name, is_ladder_match")
      .eq("id", matchId)
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // Verify match is still in a respondable state
    const isProposed =
      match.terms_status === "pending" || match.status === "proposed";

    if (!isProposed) {
      return NextResponse.json(
        { error: "This match is no longer pending" },
        { status: 403 }
      );
    }

    // Verify the authenticated user is the opponent
    const userEmail = (user.email || "").trim().toLowerCase();
    const opponentEmail = (match.opponent_email || "").trim().toLowerCase();

    if (!userEmail || userEmail !== opponentEmail) {
      return NextResponse.json(
        { error: "Only the invited opponent can respond to this match" },
        { status: 403 }
      );
    }

    // Perform the update
    if (action === "accept") {
      const updateFields: Record<string, any> = {
          terms_status: "accepted",
          status: "active",
          opponent_id: user.id,
        };
      if (opponentTee) updateFields.opponent_tee = opponentTee;

      const { error: updateErr } = await supabaseAdmin
        .from("matches")
        .update(updateFields)
        .eq("id", matchId);

      if (updateErr) {
        return NextResponse.json(
          { error: updateErr.message },
          { status: 500 }
        );
      }
    } else {
      // Decline path — notify creator before deleting
      await notifyCreator(supabaseAdmin, match, action, userEmail, reason);

      // If ladder match, trigger decline-swap (challenger takes decliner's spot)
      if (match.is_ladder_match && match.creator_id) {
        try {
          for (const ladderType of ["gross", "net"]) {
            const { data: positions } = await supabaseAdmin
              .from("ladder_rankings")
              .select("id, user_id, position")
              .eq("type", ladderType)
              .in("user_id", [match.creator_id, user.id]);

            if (positions && positions.length === 2) {
              const challengerRow = positions.find((p: any) => p.user_id === match.creator_id);
              const declinerRow = positions.find((p: any) => p.user_id === user.id);
              if (challengerRow && declinerRow && challengerRow.position > declinerRow.position) {
                const now = new Date().toISOString();
                await supabaseAdmin
                  .from("ladder_rankings")
                  .update({ position: declinerRow.position, updated_at: now })
                  .eq("id", challengerRow.id);
                await supabaseAdmin
                  .from("ladder_rankings")
                  .update({ position: challengerRow.position, updated_at: now })
                  .eq("id", declinerRow.id);
              }
            }
          }
        } catch (swapErr) {
          console.error("respond-match: ladder decline-swap failed", swapErr);
        }
      }

      // Delete holes then match
      await supabaseAdmin.from("holes").delete().eq("match_id", matchId);
      const { error: delErr } = await supabaseAdmin
        .from("matches")
        .delete()
        .eq("id", matchId);

      if (delErr) {
        return NextResponse.json(
          { error: delErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true });
    }

    // Accept path — notify creator
    await notifyCreator(supabaseAdmin, match, action, userEmail, reason);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("respond-match error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

async function notifyCreator(
  supabaseAdmin: any,
  match: any,
  action: "accept" | "decline",
  opponentEmail: string,
  reason?: string
) {
  try {
    const { data: oppProfile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", match.opponent_id ?? "")
      .maybeSingle();

    const oppName = oppProfile?.display_name || opponentEmail || "Your opponent";
    const courseName = match.course_name || "Golf Match";
    const accepted = action === "accept";

    const message = accepted
      ? `${oppName} accepted your match at ${courseName}!`
      : `${oppName} declined your match at ${courseName}.${reason ? ` Reason: ${reason}` : ""}`;

    await supabaseAdmin.from("notifications").insert({
      user_id: match.creator_id,
      message,
      match_id: accepted ? match.id : null,
      read: false,
    });

    await sendPushToUser(match.creator_id, {
      title: accepted ? "Match accepted!" : "Match declined",
      body: message,
      url: accepted ? `/matches/${match.id}` : "/matches",
      matchId: match.id,
    });
  } catch {
    // Non-critical
  }
}
