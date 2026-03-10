import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: inviteId } = await params;
    const admin = adminClient();

    const { data: invite } = await admin
      .from("tournament_invites")
      .select("id, tournament_id, created_by")
      .eq("id", inviteId)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const { data: tournament } = await admin
      .from("tournaments")
      .select("id, name, description, creator_id, period_type, period_count, start_date, end_date, status")
      .eq("id", invite.tournament_id)
      .single();

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    // Get creator profile
    const { data: creator } = await admin
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", tournament.creator_id)
      .maybeSingle();

    // Check if user is already a participant
    const { data: existing } = await admin
      .from("tournament_participants")
      .select("status")
      .eq("tournament_id", tournament.id)
      .eq("user_id", user.id)
      .maybeSingle();

    // Get participant count
    const { data: parts } = await admin
      .from("tournament_participants")
      .select("id")
      .eq("tournament_id", tournament.id)
      .eq("status", "accepted");

    return NextResponse.json({
      tournament,
      creator: creator ?? null,
      participantCount: (parts ?? []).length,
      alreadyJoined: existing?.status === "accepted",
      alreadyInvited: !!existing,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: inviteId } = await params;
    const admin = adminClient();

    const { data: invite } = await admin
      .from("tournament_invites")
      .select("tournament_id")
      .eq("id", inviteId)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    // Upsert participant
    const { error: upErr } = await admin
      .from("tournament_participants")
      .upsert(
        {
          tournament_id: invite.tournament_id,
          user_id: user.id,
          status: "accepted",
          joined_at: new Date().toISOString(),
        },
        { onConflict: "tournament_id,user_id" }
      );

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, tournament_id: invite.tournament_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
