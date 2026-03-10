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
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabaseAuth.auth.getUser(bearer);
    return { user: data.user, error };
  }

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });

  const { data, error } = await supabaseAuth.auth.getUser();
  return { user: data.user, error };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as any;
    const matchId =
      typeof body?.matchId === "string" ? body.matchId.trim() : "";
    const action = typeof body?.action === "string" ? body.action.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!matchId) {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
    }

    if (action !== "accept" && action !== "decline") {
      return NextResponse.json(
        { error: "action must be \"accept\" or \"decline\"" },
        { status: 400 }
      );
    }

    const { user, error: userErr } = await getAuthedUser(request);

    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!serviceKey) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Fetch match
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("id, creator_id, opponent_id, status, terms_status, opponent_email, course_name, is_ladder_match")
      .eq("id", matchId)
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // Verify match is still in a respondable state
    const isProposed =
      match.terms_status === "pending" || match.status === "proposed";

    if (!isProposed) {
      return NextResponse.json(
        { error: "This match is no longer pending" },
        { status: 403 }
      );
    }

    // Verify the authenticated user is the opponent
    const userEmail = (user.email || "").trim().toLowerCase();
    const opponentEmail = (match.opponent_email || "").trim().toLowerCase();

    if (!userEmail || userEmail !== opponentEmail) {
      return NextResponse.json(
        { error: "Only the invited opponent can respond to this match" },
        { status: 403 }
      );
    }

    // Perform the update
    if (action === "accept") {
      const { error: updateErr } = await supabaseAdmin
        .from("matches")
        .update({
          terms_status: "accepted",
          status: "active",
          opponent_id: user.id,
        })
        .eq("id", matchId);

      if (updateErr) {
        return NextResponse.json(
          { error: updateErr.message },
          { status: 500 }
        );
      }
    } else {
      // Send notification email BEFORE deleting so we still have match data
      await sendCreatorNotification(supabaseAdmin, match, action, userEmail, reason);

      // If ladder match, trigger decline-swap (challenger takes decliner's spot)
      if (match.is_ladder_match && match.creator_id) {
        try {
          for (const ladderType of ["gross", "net"]) {
            const { data: positions } = await supabaseAdmin
              .from("ladder_rankings")
              .select("id, user_id, position")
              .eq("type", ladderType)
              .in("user_id", [match.creator_id, user.id]);

            if (positions && positions.length === 2) {
              const challengerRow = positions.find((p: any) => p.user_id === match.creator_id);
              const declinerRow = positions.find((p: any) => p.user_id === user.id);
              if (challengerRow && declinerRow && challengerRow.position > declinerRow.position) {
                const now = new Date().toISOString();
                await supabaseAdmin
                  .from("ladder_rankings")
                  .update({ position: declinerRow.position, updated_at: now })
                  .eq("id", challengerRow.id);
                await supabaseAdmin
                  .from("ladder_rankings")
                  .update({ position: challengerRow.position, updated_at: now })
                  .eq("id", declinerRow.id);
              }
            }
          }
        } catch (swapErr) {
          console.error("respond-match: ladder decline-swap failed", swapErr);
        }
      }

      // Delete holes then match
      await supabaseAdmin.from("holes").delete().eq("match_id", matchId);
      const { error: delErr } = await supabaseAdmin
        .from("matches")
        .delete()
        .eq("id", matchId);

      if (delErr) {
        return NextResponse.json(
          { error: delErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true });
    }

    // Send notification email to the match creator (accept path)
    await sendCreatorNotification(supabaseAdmin, match, action, userEmail, reason);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("respond-match error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

async function sendCreatorNotification(
  supabaseAdmin: any,
  match: any,
  action: "accept" | "decline",
  opponentEmail: string,
  reason?: string
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL || "onboarding@resend.dev";

  if (!apiKey) {
    console.error("respond-match: Missing RESEND_API_KEY, skipping notification email");
    return;
  }

  // Look up creator email via Supabase auth admin
  const { data: creatorData, error: creatorErr } =
    await supabaseAdmin.auth.admin.getUserById(match.creator_id);

  if (creatorErr || !creatorData?.user?.email) {
    console.error("respond-match: Could not look up creator email", creatorErr);
    return;
  }

  const creatorEmail = creatorData.user.email;
  const courseName = match.course_name || "Golf Ladder Match";
  const accepted = action === "accept";

  const subject = accepted
    ? "Match accepted: " + courseName
    : "Match declined: " + courseName;

  const statusLabel = accepted ? "accepted" : "declined";
  const statusColor = accepted ? "#16a34a" : "#dc2626";

  const reasonHtml = !accepted && reason
    ? "  <p style=\"margin-top:12px;padding:12px 16px;background:#fef2f2;border-radius:10px;color:#991b1b;font-size:14px\"><b>Reason:</b> " + reason.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>"
    : "";

  const html = [
    "<div style=\"font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:480px\">",
    "  <h2 style=\"margin-bottom:4px\">Match " + statusLabel + "</h2>",
    "  <p style=\"color:#555;margin-top:0\">Private club competition, refined.</p>",
    "  <p><b>Course:</b> " + courseName + "</p>",
    "  <p><b>Opponent:</b> " + opponentEmail + "</p>",
    "  <p style=\"margin-top:12px\">",
    "    <span style=\"display:inline-block;padding:8px 16px;border-radius:10px;color:#fff;background:" + statusColor + ";font-weight:600\">" + statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1) + "</span>",
    "  </p>",
    reasonHtml,
    accepted
      ? "  <p style=\"margin-top:16px\">The match is now active. Good luck!</p>"
      : "  <p style=\"margin-top:16px\">The opponent has declined this match and it has been removed.</p>",
    "  <p style=\"margin-top:24px;font-size:12px;color:#888\">Reciprocity</p>",
    "</div>",
  ].join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: creatorEmail,
        subject,
        html,
      }),
    });

    if (!r.ok) {
      const data = await r.json().catch(() => null);
      console.error("respond-match: Resend error", r.status, data);
    }
  } catch (emailErr) {
    console.error("respond-match: Failed to send notification email", emailErr);
  }
}
