import { NextResponse, type NextRequest } from "next/server";

export function updateSession(request: NextRequest) {
  return NextResponse.next({ request });
}
