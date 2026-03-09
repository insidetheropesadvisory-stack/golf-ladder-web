import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  // Pass the code to a client-side page that can exchange it
  // using the localStorage-based supabase client
  const target = new URL("/auth/callback/exchange", url.origin);
  if (code) target.searchParams.set("code", code);
  target.searchParams.set("next", next);

  return NextResponse.redirect(target);
}
