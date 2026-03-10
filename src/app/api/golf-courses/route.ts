import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.GOLF_COURSE_API_KEY!;
const BASE_URL = "https://www.golfapi.io/api/v2.3";

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
    // Keep backwards compat: "id" = courseId
    const legacyId = url.searchParams.get("id");

    const headers = { Authorization: `Bearer ${API_KEY}` };

    // Single course lookup by courseID — returns full tee/hole data
    if (courseId || legacyId) {
      const cid = courseId || legacyId;
      const res = await fetch(`${BASE_URL}/courses/${cid}`, { headers });

      if (!res.ok) {
        return NextResponse.json({ error: "Course not found" }, { status: 404 });
      }

      const data = await res.json();

      // Normalize into the shape our frontend expects
      const course = normalizeCourse(data);
      return NextResponse.json({ course });
    }

    // Club detail by clubID
    if (clubId) {
      const res = await fetch(`${BASE_URL}/clubs/${clubId}`, { headers });

      if (!res.ok) {
        return NextResponse.json({ error: "Club not found" }, { status: 404 });
      }

      const data = await res.json();
      return NextResponse.json({ club: data });
    }

    // Search clubs by name
    if (!query && !state) {
      return NextResponse.json({ courses: [], count: 0 });
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

    // Map to a consistent shape for the frontend
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

    return NextResponse.json({
      courses,
      count: courses.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * Normalize golfapi.io course response into the shape our ClubPicker/scoring pages expect.
 * Old shape: { tees: { "Blue": { par, slope, course_rating, total_yards, holes: [...] } } }
 * New API:   { tees: [...], parsMen: [...], length1..length18 per tee }
 */
function normalizeCourse(data: any) {
  const tees: Record<string, any> = {};

  for (const tee of (data.tees ?? []) as any[]) {
    // Sum hole lengths for total yards
    let totalYards = 0;
    const holes: any[] = [];
    for (let h = 1; h <= 18; h++) {
      const yards = tee[`length${h}`] ?? 0;
      totalYards += Number(yards) || 0;
      const par = data.parsMen?.[h - 1] ?? data.parsWomen?.[h - 1] ?? null;
      holes.push({
        number: h,
        par,
        yardage: Number(yards) || 0,
      });
    }

    // Sum par from parsMen
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
