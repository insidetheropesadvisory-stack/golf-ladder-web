import { NextResponse } from "next/server";

function normalizeRecipient(to: string) {
  const trimmed = to.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at === -1) return { original: to, effective: trimmed };

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  // Gmail supports plus addressing, but some delivery setups treat +aliases weirdly.
  // This makes invites land in the base Gmail inbox for MVP/testing.
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  if (!isGmail) return { original: to, effective: trimmed };

  const plus = local.indexOf("+");
  const effectiveLocal = plus >= 0 ? local.slice(0, plus) : local;

  return { original: to, effective: `${effectiveLocal}@${domain}` };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { to, matchUrl, courseName, roundTime, hostEmail } = body;

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.INVITE_FROM_EMAIL || "onboarding@resend.dev";

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing RESEND_API_KEY in server env. Add to .env.local and restart npm run dev.",
        },
        { status: 500 }
      );
    }

    if (!to || !matchUrl) {
      return NextResponse.json({ ok: false, error: "Missing to or matchUrl" }, { status: 400 });
    }

    const { original, effective } = normalizeRecipient(to);

    const subject = `You’ve been challenged: ${courseName || "Golf Ladder Match"}`;
    const whenLine = roundTime ? `Round time: ${roundTime}` : `Round time: (not set)`;

    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.4">
        <h2>You’ve been challenged 🏌️</h2>
        <p><b>Course:</b> ${courseName || "-"}</p>
        <p><b>${whenLine}</b></p>
        <p><b>From:</b> ${hostEmail || "Golf Ladder"}</p>
        <p style="margin-top:16px">
          <a href="${matchUrl}" style="display:inline-block;padding:10px 14px;border:1px solid #111;border-radius:10px;text-decoration:none;color:#111">
            Open match
          </a>
        </p>
        <p style="margin-top:16px;font-size:12px;color:#666">
          If the button doesn’t work, copy/paste this link:<br/>
          ${matchUrl}
        </p>
        <p style="margin-top:16px;font-size:12px;color:#666">
          Sent to: ${effective}${effective !== original.trim().toLowerCase() ? ` (from ${original})` : ""}
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
        to: effective,
        subject,
        html,
      }),
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Resend returned an error",
          resend_status: r.status,
          resend_response: data,
          from,
          to_original: original,
          to_effective: effective,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      resend: data,
      from,
      to_original: original,
      to_effective: effective,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}