import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PlayerLite = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as any;

    const idsRaw: any[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids: string[] = Array.from(
      new Set(
        idsRaw
          .map((x: any) => String(x ?? "").trim())
          .filter((s: string) => s.length > 0)
      )
    ).slice(0, 50);

    const { user, error: userErr } = await getAuthedUser(request);

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 401 });
    }

    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const userId = String(user.id ?? "");

    const supabaseAdmin = adminClient();

    const { data: matchRows, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("creator_id, opponent_id")
      .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
      .limit(1000);

    if (matchErr) {
      return NextResponse.json({ error: matchErr.message }, { status: 500 });
    }

    const allowed = new Set<string>();
    (matchRows ?? []).forEach((r: any) => {
      if (r?.creator_id) allowed.add(String(r.creator_id));
      if (r?.opponent_id) allowed.add(String(r.opponent_id));
    });

    const requestedAllowed = ids.filter((id) => allowed.has(id) && id !== userId);

    if (requestedAllowed.length === 0) {
      return NextResponse.json({ players: {} });
    }

    const { data: playersRows, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, avatar_url, handicap_index")
      .in("id", requestedAllowed);

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }

    const out: Record<string, PlayerLite> = {};
    (playersRows ?? []).forEach((p: any) => {
      const id = String(p.id);
      out[id] = {
        id,
        display_name: p.display_name ?? null,
        avatar_url: p.avatar_url ?? null,
        handicap_index: p.handicap_index ?? null,
      };
    });

    return NextResponse.json({ players: out });
  } catch (e: any) {
    console.error("players lookup route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}