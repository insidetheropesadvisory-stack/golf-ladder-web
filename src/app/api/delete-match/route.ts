import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as any;
    const matchId = typeof body?.matchId === "string" ? body.matchId.trim() : "";

    if (!matchId) {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
    }

    const { user, error: userErr } = await getAuthedUser(request);

    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const supabaseAdmin = adminClient();

    // Fetch match to verify ownership and status
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("id, creator_id, status, terms_status")
      .eq("id", matchId)
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (match.creator_id !== user.id) {
      return NextResponse.json(
        { error: "Only the match creator can delete it" },
        { status: 403 }
      );
    }

    const isProposed =
      match.status === "proposed" || match.terms_status === "pending";

    if (!isProposed) {
      return NextResponse.json(
        { error: "Only proposed matches can be deleted" },
        { status: 403 }
      );
    }

    // Delete holes first, then match
    await supabaseAdmin.from("holes").delete().eq("match_id", matchId);
    const { error: delErr } = await supabaseAdmin
      .from("matches")
      .delete()
      .eq("id", matchId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("delete-match error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
