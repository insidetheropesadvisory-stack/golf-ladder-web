// src/app/api/players/lookup/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type PlayerLite = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
};

export async function POST(request: Request) {
  try {
    // ✅ request.json() is `unknown` in many TS configs — cast it
    const body = (await request.json().catch(() => ({}))) as any;

    const idsRaw: any[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids: string[] = Array.from(
      new Set(
        idsRaw
          .map((x: any) => String(x ?? "").trim())
          .filter((s: string) => s.length > 0)
      )
    ).slice(0, 50);

    // Must be signed in
    const cookieStore = await cookies();

    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // no-op
          },
        },
      }
    );

    const { data: userRes, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 401 });

    const user = userRes.user;
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    // ✅ Normalize user id to string (avoid `unknown` ripples)
    const userId = String((user as any).id ?? "");

    // Service role client (bypasses RLS)
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY in env" }, { status: 500 });
    }

    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
      auth: { persistSession: false },
    });

    // Compute which ids are allowed (only people in your matches)
    const { data: matchRows, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("creator_id, opponent_id")
      .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
      .limit(1000);

    if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 });

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

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

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
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}