import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

const DEADLINE_MS = 12 * 60 * 60 * 1000; // 12 hours
const REMINDER_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours into window

/**
 * POST /api/matches/resolve
 * Called on matches page load. Resolves expired matches and sends reminders.
 * - If one player scored all 18 and the other didn't within 12h → auto-complete, winner = scorer
 * - If neither scored all 18 within 12h → mark expired, notify both to reschedule
 * - If in active window (past 6h) and player hasn't scored → send reminder
 */
export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const admin = adminClient();
    const now = new Date();

    // Find active (non-completed) matches for this user that have a round_time
    const { data: matches } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, round_time, course_name, is_ladder_match, format, use_handicap, hole_count")
      .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
      .eq("status", "active")
      .eq("completed", false)
      .not("round_time", "is", null);

    if (!matches || matches.length === 0) {
      return NextResponse.json({ resolved: 0, reminded: 0 });
    }

    let resolvedCount = 0;
    let remindedCount = 0;

    for (const match of matches as any[]) {
      const roundTime = new Date(match.round_time);
      const deadline = new Date(roundTime.getTime() + DEADLINE_MS);

      // Still within window
      if (now <= deadline) {
        // Send reminder if past 6h mark, match has started, and user hasn't finished scoring
        const reminderTime = new Date(roundTime.getTime() + REMINDER_THRESHOLD_MS);
        if (now >= reminderTime && now >= roundTime) {
          const { count } = await admin
            .from("holes")
            .select("id", { count: "exact", head: true })
            .eq("match_id", match.id)
            .eq("player_id", user.id);

          if ((count ?? 0) < (match.hole_count ?? 18)) {
            // Check if we already sent a deadline reminder for this match
            const { data: existing } = await admin
              .from("notifications")
              .select("id")
              .eq("user_id", user.id)
              .eq("match_id", match.id)
              .like("message", "%scoring deadline%")
              .maybeSingle();

            if (!existing) {
              const hoursLeft = Math.max(1, Math.ceil((deadline.getTime() - now.getTime()) / (60 * 60 * 1000)));
              const msg = `Your match at ${match.course_name || "the course"} has a scoring deadline in ~${hoursLeft} hours. Enter your scores now!`;

              await admin.from("notifications").insert({
                user_id: user.id,
                message: msg,
                match_id: match.id,
                read: false,
              });

              sendPushToUser(user.id, {
                title: "Score reminder",
                body: msg,
                url: `/matches/${match.id}`,
                matchId: match.id,
              }).catch(() => {});

              remindedCount++;
            }
          }
        }
        continue;
      }

      // Past deadline — resolve this match
      const { data: holeData } = await admin
        .from("holes")
        .select("player_id, hole_no, strokes")
        .eq("match_id", match.id);

      const creatorHoles = new Set<number>();
      const opponentHoles = new Set<number>();

      for (const h of (holeData ?? []) as any[]) {
        if (typeof h.strokes !== "number") continue;
        if (h.player_id === match.creator_id) creatorHoles.add(h.hole_no);
        else if (h.player_id === match.opponent_id) opponentHoles.add(h.hole_no);
      }

      const reqHoles = match.hole_count ?? 18;
      const creatorDone = creatorHoles.size >= reqHoles;
      const opponentDone = opponentHoles.size >= reqHoles;

      if (creatorDone && opponentDone) {
        // Both completed — just mark as completed
        await admin
          .from("matches")
          .update({ completed: true, status: "completed" })
          .eq("id", match.id);

        resolvedCount++;
      } else if (creatorDone || opponentDone) {
        // One player completed — they win by default
        const winnerId = creatorDone ? match.creator_id : match.opponent_id;
        const loserId = creatorDone ? match.opponent_id : match.creator_id;

        await admin
          .from("matches")
          .update({ completed: true, status: "completed" })
          .eq("id", match.id);

        // Notify winner
        if (winnerId) {
          const winMsg = `You won your match at ${match.course_name || "the course"} — your opponent didn't submit scores in time.`;
          await admin.from("notifications").insert({
            user_id: winnerId,
            message: winMsg,
            match_id: match.id,
            read: false,
          });
          sendPushToUser(winnerId, {
            title: "Match won!",
            body: winMsg,
            url: `/matches/${match.id}`,
            matchId: match.id,
          }).catch(() => {});
        }

        // Notify loser
        if (loserId) {
          const loseMsg = `Your match at ${match.course_name || "the course"} expired — you didn't submit scores within 12 hours. The win goes to your opponent.`;
          await admin.from("notifications").insert({
            user_id: loserId,
            message: loseMsg,
            match_id: match.id,
            read: false,
          });
          sendPushToUser(loserId, {
            title: "Match expired",
            body: loseMsg,
            url: `/matches/${match.id}`,
            matchId: match.id,
          }).catch(() => {});
        }

        // Ladder swap if applicable
        if (match.is_ladder_match && winnerId && loserId) {
          try {
            for (const ladderType of ["gross", "net"]) {
              const { data: positions } = await admin
                .from("ladder_rankings")
                .select("id, user_id, position")
                .eq("type", ladderType)
                .in("user_id", [winnerId, loserId]);

              if (positions && positions.length === 2) {
                const winnerRow = positions.find((p: any) => p.user_id === winnerId);
                const loserRow = positions.find((p: any) => p.user_id === loserId);
                if (winnerRow && loserRow && winnerRow.position > loserRow.position) {
                  const ts = new Date().toISOString();
                  await admin.from("ladder_rankings").update({ position: loserRow.position, updated_at: ts }).eq("id", winnerRow.id);
                  await admin.from("ladder_rankings").update({ position: winnerRow.position, updated_at: ts }).eq("id", loserRow.id);
                }
              }
            }
          } catch {}
        }

        resolvedCount++;
      } else {
        // Neither completed — expire, notify to reschedule
        await admin
          .from("matches")
          .update({ status: "expired" })
          .eq("id", match.id);

        for (const pid of [match.creator_id, match.opponent_id].filter(Boolean)) {
          const msg = `Your match at ${match.course_name || "the course"} expired — neither player submitted scores within 12 hours. Consider rescheduling!`;
          await admin.from("notifications").insert({
            user_id: pid,
            message: msg,
            match_id: match.id,
            read: false,
          });
          sendPushToUser(pid, {
            title: "Match expired — reschedule?",
            body: msg,
            url: "/matches",
            matchId: match.id,
          }).catch(() => {});
        }

        resolvedCount++;
      }
    }

    return NextResponse.json({ resolved: resolvedCount, reminded: remindedCount });
  } catch (e: any) {
    console.error("resolve-matches error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
