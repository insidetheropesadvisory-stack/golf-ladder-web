import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const API_KEY = process.env.GOLF_COURSE_API_KEY!;
const BASE_URL = "https://api.golfcourseapi.com/v1";

// In-memory progressive cache — survives across requests on the same serverless instance
let cachedCourses: any[] = [];
let cachedPages = 0; // how many pages we've fetched so far
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Background cache builder — fetches pages incrementally without blocking requests
let isCacheBuilding = false;

async function buildCacheInBackground() {
  if (isCacheBuilding) return;
  isCacheBuilding = true;

  try {
    // Fetch in chunks of 50 pages (~1000 courses) per background run
    const startPage = cachedPages + 1;
    const endPage = startPage + 50;
    let page = startPage;

    while (page <= endPage) {
      const res = await fetch(`${BASE_URL}/courses?page=${page}`, {
        headers: { Authorization: `Key ${API_KEY}` },
      });

      if (!res.ok) break;
      const data = await res.json();
      const batch = data.courses ?? [];
      if (batch.length === 0) {
        // We've reached the end of all courses
        cachedPages = 99999; // mark as fully loaded
        break;
      }

      cachedCourses.push(...batch);
      cachedPages = page;
      page++;
    }

    cacheTimestamp = Date.now();
  } catch {
    // Silently fail — cache will continue building on next request
  }

  isCacheBuilding = false;
}

function resetCacheIfStale() {
  if (cacheTimestamp && Date.now() - cacheTimestamp > CACHE_TTL) {
    cachedCourses = [];
    cachedPages = 0;
    cacheTimestamp = 0;
  }
}

function searchCourseFormat(c: any) {
  return {
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
  };
}

function matchesCourse(c: any, query: string, state: string): boolean {
  const matchesState = !state || (c.location?.state ?? "").toUpperCase() === state;
  const matchesQuery =
    !query ||
    (c.club_name ?? "").toLowerCase().includes(query) ||
    (c.course_name ?? "").toLowerCase().includes(query) ||
    (c.location?.city ?? "").toLowerCase().includes(query);
  return matchesState && matchesQuery;
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

    // If no search query, return first batch
    if (!query && !state) {
      resetCacheIfStale();
      if (cachedCourses.length === 0) {
        // Fetch first page for immediate results
        const res = await fetch(`${BASE_URL}/courses?page=1`, {
          headers: { Authorization: `Key ${API_KEY}` },
        });
        if (res.ok) {
          const data = await res.json();
          const batch = data.courses ?? [];
          cachedCourses = batch;
          cachedPages = 1;
          cacheTimestamp = Date.now();
        }
      }
      // Start building cache in background
      buildCacheInBackground();
      return NextResponse.json({
        courses: cachedCourses.slice(0, limit).map(searchCourseFormat),
        count: Math.min(cachedCourses.length, limit),
      });
    }

    // Search: try external API search parameter first
    const searchResults: any[] = [];

    // Attempt 1: Try external API search endpoints (undocumented)
    for (const param of ["search", "name"]) {
      if (searchResults.length >= limit) break;
      try {
        const res = await fetch(
          `${BASE_URL}/courses?${param}=${encodeURIComponent(query)}&page=1`,
          { headers: { Authorization: `Key ${API_KEY}` } }
        );
        if (res.ok) {
          const data = await res.json();
          const courses = data.courses ?? [];
          // If the API returned filtered results (not the same as page 1 without search),
          // use them
          if (courses.length > 0) {
            for (const c of courses) {
              if (matchesCourse(c, query, state)) {
                searchResults.push(searchCourseFormat(c));
                if (searchResults.length >= limit) break;
              }
            }
            // If we got search results, the API supports search — return them
            if (searchResults.length > 0) {
              return NextResponse.json({ courses: searchResults, count: searchResults.length });
            }
          }
        }
      } catch {
        // Param not supported, continue
      }
    }

    // Attempt 2: Search against our progressive cache
    resetCacheIfStale();

    if (cachedCourses.length > 0) {
      const cacheResults: any[] = [];
      for (const c of cachedCourses) {
        if (matchesCourse(c, query, state)) {
          cacheResults.push(searchCourseFormat(c));
          if (cacheResults.length >= limit) break;
        }
      }

      // Start building more cache in the background
      buildCacheInBackground();

      if (cacheResults.length > 0) {
        return NextResponse.json({
          courses: cacheResults,
          count: cacheResults.length,
          cached: true,
          cachedTotal: cachedCourses.length,
        });
      }
    }

    // Attempt 3: Stream-search through pages we haven't cached yet
    // This handles the case where cache is empty or search term is in later pages
    const startPage = cachedPages + 1;
    const maxNewPages = 100; // Check up to 2000 more courses
    const seenIds = new Set<number>(searchResults.map((r) => r.id));
    let page = startPage;

    while (searchResults.length < limit && page <= startPage + maxNewPages) {
      const res = await fetch(`${BASE_URL}/courses?page=${page}`, {
        headers: { Authorization: `Key ${API_KEY}` },
      });

      if (!res.ok) break;
      const data = await res.json();
      const batch = data.courses ?? [];
      if (batch.length === 0) break;

      // Add to cache as we go
      if (page > cachedPages) {
        cachedCourses.push(...batch);
        cachedPages = page;
        cacheTimestamp = Date.now();
      }

      for (const c of batch) {
        if (seenIds.has(c.id)) continue;
        seenIds.add(c.id);

        if (matchesCourse(c, query, state)) {
          searchResults.push(searchCourseFormat(c));
          if (searchResults.length >= limit) break;
        }
      }

      page++;
    }

    // Keep building cache in background for future searches
    buildCacheInBackground();

    return NextResponse.json({ courses: searchResults, count: searchResults.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
