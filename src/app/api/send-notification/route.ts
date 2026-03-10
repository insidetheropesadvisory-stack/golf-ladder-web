import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function getAuthedUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const bearer =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

  if (bearer) {
    const sb = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser(bearer);
    return { user: data.user, error };
  }

  const cookieStore = await cookies();
  const sb = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
  });
  const { data, error } = await sb.auth.getUser();
  return { user: data.user, error };
}

export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.INVITE_FROM_EMAIL || "onboarding@resend.dev";

    if (!apiKey) {
      return NextResponse.json({ error: "Missing RESEND_API_KEY" }, { status: 500 });
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const type = String(body.type ?? "").trim();

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // --- Type: scoring_complete ---
    // Sent when a player finishes scoring all their holes
    if (type === "scoring_complete") {
      const matchId = String(body.matchId ?? "").trim();
      if (!matchId) {
        return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
      }

      // Fetch match
      const { data: match } = await admin
        .from("matches")
        .select("id, creator_id, opponent_id, course_name, is_ladder_match")
        .eq("id", matchId)
        .single();

      if (!match) {
        return NextResponse.json({ error: "Match not found" }, { status: 404 });
      }

      // Determine who to notify (the other player)
      const recipientId =
        user.id === match.creator_id ? match.opponent_id : match.creator_id;

      if (!recipientId) {
        return NextResponse.json({ error: "No opponent to notify" }, { status: 400 });
      }

      // Get recipient email via auth admin
      const { data: recipientData } = await admin.auth.admin.getUserById(recipientId);
      const recipientEmail = recipientData?.user?.email;

      if (!recipientEmail) {
        return NextResponse.json({ error: "Recipient email not found" }, { status: 404 });
      }

      // Get sender display name
      const { data: senderProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const senderName = senderProfile?.display_name || user.email || "Your opponent";
      const courseName = match.course_name || "Golf Match";
      const matchUrl = body.matchUrl || "";
      const ladderLabel = match.is_ladder_match ? " (Ladder)" : "";

      const subject = `${senderName} finished scoring — your turn!`;

      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:480px">
          <h2 style="margin-bottom:4px">Scores are in</h2>
          <p style="color:#555;margin-top:0">${senderName} has completed their scorecard for <b>${courseName}</b>${ladderLabel}.</p>
          <p>It's your turn to enter your scores so the match can be finalized.</p>
          ${matchUrl ? `
          <p style="margin-top:16px">
            <a href="${matchUrl}" style="display:inline-block;padding:10px 20px;background:#0b3b2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">
              Enter your scores
            </a>
          </p>
          <p style="margin-top:12px;font-size:12px;color:#888">
            Or copy this link: ${matchUrl}
          </p>
          ` : ""}
          <p style="margin-top:24px;font-size:12px;color:#888">Reciprocity</p>
        </div>
      `;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: recipientEmail, subject, html }),
      });

      return NextResponse.json({ ok: true });
    }

    // --- Type: pending_reminder ---
    // Remind opponent they have a pending challenge
    if (type === "pending_reminder") {
      const matchId = String(body.matchId ?? "").trim();
      if (!matchId) {
        return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
      }

      const { data: match } = await admin
        .from("matches")
        .select("id, creator_id, opponent_id, opponent_email, course_name, round_time, guest_fee, is_ladder_match, status, terms_status")
        .eq("id", matchId)
        .single();

      if (!match) {
        return NextResponse.json({ error: "Match not found" }, { status: 404 });
      }

      // Only the creator can send a reminder
      if (user.id !== match.creator_id) {
        return NextResponse.json({ error: "Only the challenger can send a reminder" }, { status: 403 });
      }

      // Only for pending matches
      if (match.status !== "proposed" && match.terms_status !== "pending") {
        return NextResponse.json({ error: "Match is not pending" }, { status: 400 });
      }

      // Get opponent email
      let recipientEmail = match.opponent_email;
      if (!recipientEmail && match.opponent_id) {
        const { data: oppData } = await admin.auth.admin.getUserById(match.opponent_id);
        recipientEmail = oppData?.user?.email ?? null;
      }

      if (!recipientEmail) {
        return NextResponse.json({ error: "Opponent email not found" }, { status: 404 });
      }

      // Get sender name
      const { data: senderProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const senderName = senderProfile?.display_name || user.email || "A player";
      const courseName = match.course_name || "Golf Match";
      const matchUrl = body.matchUrl || "";
      const ladderLabel = match.is_ladder_match ? " (Ladder)" : "";
      const feeLine = match.guest_fee != null ? `<p><b>Guest fee:</b> $${match.guest_fee}</p>` : "";
      const timeLine = match.round_time
        ? `<p><b>Tee time:</b> ${new Date(match.round_time).toLocaleString()}</p>`
        : "";

      const subject = `Reminder: ${senderName} is waiting for your response`;

      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:480px">
          <h2 style="margin-bottom:4px">You have a pending challenge</h2>
          <p style="color:#555;margin-top:0">${senderName} challenged you to a match${ladderLabel}.</p>
          <p><b>Course:</b> ${courseName}</p>
          ${timeLine}
          ${feeLine}
          <p style="margin-top:8px">Accept or decline before the tee time.</p>
          ${matchUrl ? `
          <p style="margin-top:16px">
            <a href="${matchUrl}" style="display:inline-block;padding:10px 20px;background:#0b3b2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">
              View challenge
            </a>
          </p>
          <p style="margin-top:12px;font-size:12px;color:#888">
            Or copy this link: ${matchUrl}
          </p>
          ` : ""}
          <p style="margin-top:24px;font-size:12px;color:#888">Reciprocity</p>
        </div>
      `;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: recipientEmail, subject, html }),
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
  } catch (e: any) {
    console.error("send-notification error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
