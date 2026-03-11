import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

/**
 * POST /api/matches/[id]/attest
 * Opponent confirms the round occurred → creator earns 1 Tee
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: authErr } = await getAuthedUser(request);
    if (authErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: matchId } = await params;
    const admin = adminClient();

    const { data: match } = await admin
      .from("matches")
      .select("id, creator_id, opponent_id, status, completed, is_ladder_match, course_name")
      .eq("id", matchId)
      .single();

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (user.id !== match.opponent_id) {
      return NextResponse.json({ error: "Only the opponent can attest" }, { status: 403 });
    }

    if (!match.completed || match.status !== "completed") {
      return NextResponse.json({ error: "Match must be completed first" }, { status: 400 });
    }

    if (match.is_ladder_match) {
      return NextResponse.json({ error: "Ladder matches don't use Tees" }, { status: 400 });
    }

    // Check not already attested
    const { data: existing } = await admin
      .from("match_attestations")
      .select("id")
      .eq("match_id", matchId)
      .eq("attester_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Already confirmed" }, { status: 400 });
    }

    // Insert attestation
    const { error: attErr } = await admin
      .from("match_attestations")
      .insert({
        match_id: matchId,
        attester_id: user.id,
        host_id: match.creator_id,
      });

    if (attErr) {
      return NextResponse.json({ error: attErr.message }, { status: 500 });
    }

    // Award 1 Tee to creator (host)
    const { data: hostProfile } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", match.creator_id)
      .single();

    await admin
      .from("profiles")
      .update({ credits: (hostProfile?.credits ?? 3) + 1 })
      .eq("id", match.creator_id);

    // Notify creator
    const { data: attesterProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();

    const attesterName = attesterProfile?.display_name || "Your opponent";
    await admin.from("notifications").insert({
      user_id: match.creator_id,
      message: `${attesterName} confirmed your match at ${match.course_name} occurred. You earned 1 Tee!`,
      read: false,
    });

    sendPushToUser(match.creator_id, {
      title: "You earned a Tee!",
      body: `${attesterName} confirmed your match occurred.`,
      url: `/matches/${matchId}`,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("match attest error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
