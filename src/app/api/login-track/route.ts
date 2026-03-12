import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/login-track
 *
 * Records today's login for the authenticated user.
 * Upserts so calling multiple times per day is harmless.
 */
export async function POST(request: Request) {
  try {
    const { user, error: authErr } = await getAuthedUser(request);
    if (authErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const sb = adminClient();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    await sb
      .from("user_logins")
      .upsert(
        { user_id: user.id, login_date: today },
        { onConflict: "user_id,login_date" }
      );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
