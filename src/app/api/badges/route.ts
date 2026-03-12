import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { BADGES, TIER_ORDER } from "@/lib/badges/defs";

export const runtime = "nodejs";

/**
 * GET /api/badges?userId=<uuid>
 *
 * Returns all badge definitions with earned status for the given user.
 * If no userId, returns badges for the authenticated user.
 */
export async function GET(request: Request) {
  try {
    const { user, error: authErr } = await getAuthedUser(request);
    if (authErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const url = new URL(request.url);
    const targetId = url.searchParams.get("userId") ?? user.id;

    const sb = adminClient();

    const { data: earned } = await sb
      .from("user_badges")
      .select("badge_slug, unlocked_at")
      .eq("user_id", targetId);

    const earnedMap = new Map<string, string>();
    for (const e of earned ?? []) {
      earnedMap.set(e.badge_slug, e.unlocked_at);
    }

    const badges = BADGES.map((b) => ({
      ...b,
      earned: earnedMap.has(b.slug),
      unlocked_at: earnedMap.get(b.slug) ?? null,
    }));

    // Top badges (for match cards): highest tier earned, max 3
    const top = badges
      .filter((b) => b.earned)
      .sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier])
      .slice(0, 3);

    return NextResponse.json({ badges, top });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
