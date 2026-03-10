import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.GOLF_COURSE_API_KEY!;
const BASE_URL = "https://api.golfcourseapi.com/v1";

// In-memory cache of all courses (loaded once, refreshed daily)
let cachedCourses: any[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchAllCourses(): Promise<any[]> {
  // Return cache if fresh
  if (cachedCourses && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedCourses;
  }

  const courses: any[] = [];
  let page = 1;
  const maxPages = 1500; // ~30k courses at 20 per page

  while (page <= maxPages) {
    const res = await fetch(`${BASE_URL}/courses?page=${page}`, {
      headers: { Authorization: `Key ${API_KEY}` },
    });

    if (!res.ok) break;

    const data = await res.json();
    const batch = data.courses ?? [];
    if (batch.length === 0) break;

    courses.push(...batch);
    page++;

    // Rate limit: don't hammer the API
    if (page % 50 === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  cachedCourses = courses;
  cacheTimestamp = Date.now();
  return courses;
}

export async function GET(request: Request) {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: "Missing GOLF_COURSE_API_KEY" }, { status: 500 });
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const state = (url.searchParams.get("state") ?? "").trim().toUpperCase();
    const id = url.searchParams.get("id");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);

    // Single course lookup by ID
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

    // Search: fetch a few pages from the API and filter
    // (Full cache approach is too slow for first request, so we do streaming search)
    const results: any[] = [];
    let page = 1;
    const maxPages = 100; // Search through first 2000 courses max per request
    const seenIds = new Set<number>();

    while (results.length < limit && page <= maxPages) {
      const res = await fetch(`${BASE_URL}/courses?page=${page}`, {
        headers: { Authorization: `Key ${API_KEY}` },
      });

      if (!res.ok) break;
      const data = await res.json();
      const batch = data.courses ?? [];
      if (batch.length === 0) break;

      for (const c of batch) {
        if (seenIds.has(c.id)) continue;
        seenIds.add(c.id);

        const matchesState = !state || (c.location?.state ?? "").toUpperCase() === state;
        const matchesQuery = !query ||
          (c.club_name ?? "").toLowerCase().includes(query) ||
          (c.course_name ?? "").toLowerCase().includes(query) ||
          (c.location?.city ?? "").toLowerCase().includes(query);

        if (matchesState && matchesQuery) {
          results.push({
            id: c.id,
            club_name: c.club_name,
            course_name: c.course_name,
            city: c.location?.city ?? null,
            state: c.location?.state ?? null,
            country: c.location?.country ?? null,
            address: c.location?.address ?? null,
            latitude: c.location?.latitude ?? null,
            longitude: c.location?.longitude ?? null,
            has_tees: c.tees && Object.keys(c.tees).length > 0,
          });

          if (results.length >= limit) break;
        }
      }

      page++;
    }

    return NextResponse.json({ courses: results, count: results.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
