import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const admin = adminClient();

    const { data, error } = await admin
      .from("notifications")
      .select("id, message, match_id, read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const unreadCount = (data ?? []).filter((n: any) => !n.read).length;

    return NextResponse.json({ notifications: data ?? [], unreadCount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const action = String(body.action ?? "");
    const admin = adminClient();

    if (action === "mark_read") {
      const id = body.id;
      if (id) {
        await admin.from("notifications").update({ read: true }).eq("id", id).eq("user_id", user.id);
      } else {
        // Mark all as read
        await admin.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
