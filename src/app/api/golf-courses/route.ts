import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const API_KEY = process.env.GOLF_COURSE_API_KEY!;
const BASE_URL = "https://www.golfapi.io/api/v2.3";
const CACHE_DAYS = 365;

/** Read from Supabase cache. Returns null on miss or expired. */
async function cacheGet(key: string): Promise<any | null> {
  try {
    const sb = adminClient();
    const { data } = await sb
      .from("golf_course_cache")
      .select("data, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    if (new Date(data.expires_at) < new Date()) {
      // Expired — delete and return miss
      sb.from("golf_course_cache").delete().eq("cache_key", key).then(() => {});
      return null;
    }
    return data.data;
  } catch {
    return null;
  }
}

/** Write to Supabase cache. */
async function cacheSet(key: string, value: any): Promise<void> {
  try {
    const sb = adminClient();
    const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await sb.from("golf_course_cache").upsert(
      { cache_key: key, data: value, created_at: new Date().toISOString(), expires_at: expires },
      { onConflict: "cache_key" }
    );
  } catch {
    // Non-critical
  }
}

export async function GET(request: Request) {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: "Missing GOLF_COURSE_API_KEY" }, { status: 500 });
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim();
    const state = (url.searchParams.get("state") ?? "").trim().toUpperCase();
    const courseId = url.searchParams.get("courseId");
    const clubId = url.searchParams.get("clubId");
    const legacyId = url.searchParams.get("id");

    const headers = { Authorization: `Bearer ${API_KEY}` };

    // Single course lookup by courseID — returns full tee/hole data
    if (courseId || legacyId) {
      const cid = courseId || legacyId;
      const cacheKey = `course:${cid}`;

      // Check cache first
      const cached = await cacheGet(cacheKey);
      if (cached) {
        return NextResponse.json({ course: cached, cached: true });
      }

      const res = await fetch(`${BASE_URL}/courses/${cid}`, { headers });
      if (!res.ok) {
        return NextResponse.json({ error: "Course not found" }, { status: 404 });
      }

      const data = await res.json();
      const course = normalizeCourse(data);

      // Cache the normalized course
      await cacheSet(cacheKey, course);

      return NextResponse.json({ course });
    }

    // Club detail by clubID
    if (clubId) {
      const cacheKey = `club:${clubId}`;
      const cached = await cacheGet(cacheKey);
      if (cached) {
        return NextResponse.json({ club: cached, cached: true });
      }

      const res = await fetch(`${BASE_URL}/clubs/${clubId}`, { headers });
      if (!res.ok) {
        return NextResponse.json({ error: "Club not found" }, { status: 404 });
      }

      const data = await res.json();
      await cacheSet(cacheKey, data);
      return NextResponse.json({ club: data });
    }

    // Search clubs by name
    if (!query && !state) {
      return NextResponse.json({ courses: [], count: 0 });
    }

    const cacheKey = `search:${state}:${query.toLowerCase()}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return NextResponse.json({ courses: cached, count: cached.length, cached: true });
    }

    const params = new URLSearchParams();
    if (query) params.set("name", query);
    if (state) params.set("state", state);

    const res = await fetch(`${BASE_URL}/clubs?${params.toString()}`, { headers });

    if (!res.ok) {
      return NextResponse.json({ courses: [], count: 0, error: `API returned ${res.status}` });
    }

    const data = await res.json();
    const clubs = data.clubs ?? [];

    const courses = clubs.map((c: any) => ({
      id: c.clubID,
      club_name: c.clubName,
      city: c.city ?? null,
      state: c.state ?? null,
      country: c.country ?? null,
      address: c.address ?? null,
      courses: (c.courses ?? []).map((co: any) => ({
        courseID: co.courseID,
        courseName: co.courseName,
        numHoles: co.numHoles,
      })),
    }));

    // Cache search results
    await cacheSet(cacheKey, courses);

    return NextResponse.json({
      courses,
      count: courses.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * Normalize golfapi.io course response into the shape our frontend expects.
 */
function normalizeCourse(data: any) {
  const tees: Record<string, any> = {};

  const handicaps: number[] = data.handicapsMen ?? data.handicapMen ?? data.handicapsWomen ?? [];

  for (const tee of (data.tees ?? []) as any[]) {
    let totalYards = 0;
    const holes: any[] = [];
    for (let h = 1; h <= 18; h++) {
      const yards = tee[`length${h}`] ?? 0;
      totalYards += Number(yards) || 0;
      const par = data.parsMen?.[h - 1] ?? data.parsWomen?.[h - 1] ?? null;
      const hdcp = handicaps[h - 1] ?? null;
      holes.push({
        number: h,
        par,
        yardage: Number(yards) || 0,
        handicap: hdcp != null ? Number(hdcp) : null,
      });
    }

    const parTotal = (data.parsMen ?? []).reduce((a: number, b: number) => a + (Number(b) || 0), 0) || null;

    tees[tee.teeName] = {
      par: parTotal,
      slope: tee.slopeMen || tee.slopeWomen || null,
      course_rating: tee.courseRatingMen || tee.courseRatingWomen || null,
      total_yards: totalYards || null,
      holes,
    };
  }

  return {
    id: data.courseID,
    club_name: data.clubName,
    course_name: data.courseName,
    tees,
  };
}
