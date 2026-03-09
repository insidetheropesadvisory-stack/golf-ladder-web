import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { to } = body;

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.INVITE_FROM_EMAIL || "onboarding@resend.dev";

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing RESEND_API_KEY" },
        { status: 500 }
      );
    }

    if (!to) {
      return NextResponse.json(
        { ok: false, error: "Missing to" },
        { status: 400 }
      );
    }

    const loginUrl = `${req.headers.get("origin") || "https://reciprocity.app"}/login`;

    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:480px">
        <h2 style="margin-bottom:4px">Welcome to Reciprocity</h2>
        <p style="color:#555; margin-top:0">Private club competition, refined.</p>

        <p>Your account has been created. Here's what you can do:</p>

        <ul style="padding-left:20px; color:#333">
          <li>Set up your profile with a display name and handicap</li>
          <li>Create matches and challenge opponents</li>
          <li>Track scores hole-by-hole</li>
        </ul>

        <p style="margin-top:24px">
          <a href="${loginUrl}" style="display:inline-block; padding:12px 20px; background:#0b3b2e; color:#f6f1e7; border-radius:10px; text-decoration:none; font-weight:600">
            Sign in to get started
          </a>
        </p>

        <p style="margin-top:24px; font-size:12px; color:#888">
          If the button doesn't work, copy this link:<br/>
          ${loginUrl}
        </p>
      </div>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: to.trim().toLowerCase(),
        subject: "Welcome to Reciprocity",
        html,
      }),
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: "Resend returned an error", resend_status: r.status, resend_response: data },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, resend: data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
