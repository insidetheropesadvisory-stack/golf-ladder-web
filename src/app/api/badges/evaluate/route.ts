import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { evaluateUser } from "@/lib/badges/service";

export const runtime = "nodejs";

/**
 * POST /api/badges/evaluate
 *
 * Trigger badge evaluation for the authenticated user.
 * Returns any newly earned badges.
 */
export async function POST(request: Request) {
  try {
    const { user, error: authErr } = await getAuthedUser(request);
    if (authErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const sb = adminClient();
    const newBadges = await evaluateUser(sb, user.id);

    // If new badges were earned, create notifications
    if (newBadges.length > 0) {
      const { BADGES } = await import("@/lib/badges/defs");
      const notifications = newBadges.map((b) => {
        const def = BADGES.find((d) => d.slug === b.slug);
        return {
          user_id: user.id,
          message: `New marker earned: ${def?.name ?? b.slug} — ${def?.description ?? ""}`,
          match_id: null,
          read: false,
        };
      });

      await sb.from("notifications").insert(notifications);
    }

    return NextResponse.json({ awarded: newBadges });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
