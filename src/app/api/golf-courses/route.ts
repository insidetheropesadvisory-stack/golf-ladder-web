import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const API_KEY = process.env.GOLF_COURSE_API_KEY!;
const BASE_URL = "https://api.golfcourseapi.com/v1";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: "Missing GOLF_COURSE_API_KEY" }, { status: 500 });
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim();
    const state = (url.searchParams.get("state") ?? "").trim().toUpperCase();
    const id = url.searchParams.get("id");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);

    // Single course lookup by ID — always hit the external API for full tee data
    if (id) {
      const res = await fetch(`${BASE_URL}/courses/${id}`, {
        headers: { Authorization: `Key ${API_KEY}` },
      });

      if (!res.ok) {
        return NextResponse.json({ error: "Course not found" }, { status: 404 });
      }

      const data = await res.json();
      return NextResponse.json({ course: data.course ?? null });
    }

    // Search: query the golf_courses_cache table in Supabase
    const supabase = adminClient();

    let dbQuery = supabase
      .from("golf_courses_cache")
      .select("id, club_name, course_name, city, state, country, address, latitude, longitude, has_tees");

    if (query) {
      // Use ILIKE for flexible text search across club name, course name, and city
      const pattern = `%${query}%`;
      dbQuery = dbQuery.or(
        `club_name.ilike.${pattern},course_name.ilike.${pattern},city.ilike.${pattern}`
      );
    }

    if (state) {
      dbQuery = dbQuery.ilike("state", state);
    }

    dbQuery = dbQuery.order("club_name", { ascending: true }).limit(limit);

    const { data: courses, error } = await dbQuery;

    if (error) {
      // If table doesn't exist yet, return empty with a hint
      return NextResponse.json({
        courses: [],
        count: 0,
        error: error.message,
        hint: "Run POST /api/golf-courses/seed to populate the course cache",
      });
    }

    return NextResponse.json({
      courses: courses ?? [],
      count: (courses ?? []).length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
