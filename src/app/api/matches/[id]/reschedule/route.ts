import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

/**
 * POST /api/matches/[id]/reschedule
 * Update match date/time and/or course. Either player can reschedule.
 * Cannot reschedule completed, expired, or in-progress (holes scored) matches.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: matchId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const admin = adminClient();

    // Fetch match
    const { data: match, error: matchErr } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, opponent_email, course_name, round_time, status, completed, is_ladder_match, golf_course_api_id, selected_tee, guest_fee")
      .eq("id", matchId)
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // Verify user is a participant
    const isCreator = user.id === match.creator_id;
    const isOpponent = user.id === match.opponent_id;
    if (!isCreator && !isOpponent) {
      return NextResponse.json({ error: "You are not in this match" }, { status: 403 });
    }

    // Cannot reschedule completed or expired matches
    if (match.completed || match.status === "completed") {
      return NextResponse.json({ error: "Cannot reschedule a completed match" }, { status: 400 });
    }
    if (match.status === "expired") {
      return NextResponse.json({ error: "Cannot reschedule an expired match" }, { status: 400 });
    }

    // Cannot reschedule if scoring has started
    const { count: holesScored } = await admin
      .from("holes")
      .select("id", { count: "exact", head: true })
      .eq("match_id", matchId);

    if ((holesScored ?? 0) > 0) {
      return NextResponse.json({ error: "Cannot reschedule — scoring has already started" }, { status: 400 });
    }

    // Build update object from provided fields
    const update: Record<string, any> = {};

    if (body.round_time !== undefined) {
      if (body.round_time === null) {
        update.round_time = null;
      } else {
        const rt = String(body.round_time).trim();
        if (!rt) {
          return NextResponse.json({ error: "Invalid date/time" }, { status: 400 });
        }
        // Validate it's a future date
        if (new Date(rt).getTime() < Date.now() - 60000) {
          return NextResponse.json({ error: "Round time must be in the future" }, { status: 400 });
        }
        update.round_time = rt;
      }
    }

    if (body.course_name !== undefined) {
      const name = String(body.course_name ?? "").trim();
      if (!name) {
        return NextResponse.json({ error: "Course name is required" }, { status: 400 });
      }
      update.course_name = name;
    }

    if (body.golf_course_api_id !== undefined) {
      update.golf_course_api_id = body.golf_course_api_id ?? null;
    }

    if (body.selected_tee !== undefined) {
      update.selected_tee = body.selected_tee ?? null;
    }

    if (body.guest_fee !== undefined) {
      update.guest_fee = body.guest_fee ?? null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }

    // Apply update
    const { error: updateErr } = await admin
      .from("matches")
      .update(update)
      .eq("id", matchId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Notify the other player
    const otherId = isCreator ? match.opponent_id : match.creator_id;
    if (otherId) {
      const { data: senderProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const senderName = senderProfile?.display_name || "Your opponent";
      const courseName = update.course_name || match.course_name || "your match";

      const changes: string[] = [];
      if (update.round_time) {
        try {
          const d = new Date(update.round_time);
          changes.push(`new date: ${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`);
        } catch {
          changes.push("new date/time");
        }
      }
      if (update.course_name && update.course_name !== match.course_name) {
        changes.push(`new course: ${update.course_name}`);
      }

      const changeText = changes.length > 0 ? ` — ${changes.join(", ")}` : "";
      const msg = `${senderName} rescheduled your match at ${courseName}${changeText}`;

      await admin.from("notifications").insert({
        user_id: otherId,
        message: msg,
        match_id: matchId,
        read: false,
      });

      sendPushToUser(otherId, {
        title: "Match rescheduled",
        body: msg,
        url: `/matches/${matchId}`,
        matchId,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, updated: update });
  } catch (e: any) {
    console.error("reschedule error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
