import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes (requires Vercel Pro for >60s)

const API_KEY = process.env.GOLF_COURSE_API_KEY!;
const BASE_URL = "https://api.golfcourseapi.com/v1";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: "Missing GOLF_COURSE_API_KEY" }, { status: 500 });
    }

    // Optional: protect with a secret
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");
    if (secret !== (process.env.SEED_SECRET || "seed-golf-courses")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = adminClient();
    let page = 1;
    let totalInserted = 0;
    let totalSkipped = 0;
    const batchSize = 100; // insert in batches

    // Optional: start from a specific page (for resuming)
    const startPage = Number(url.searchParams.get("page")) || 1;
    page = startPage;

    while (true) {
      // Fetch a page from the external API with retry on 429
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(`${BASE_URL}/courses?page=${page}`, {
          headers: { Authorization: `Key ${API_KEY}` },
        });
        if (res.status === 429) {
          // Rate limited — wait and retry
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        break;
      }

      if (!res || !res.ok) {
        return NextResponse.json({
          message: `Stopped at page ${page} (API returned ${res?.status ?? "no response"})`,
          totalInserted,
          totalSkipped,
          lastPage: page,
        });
      }

      const data = await res.json();
      const courses = data.courses ?? [];
      if (courses.length === 0) {
        break; // no more courses
      }

      // Transform to our table schema
      const rows = courses.map((c: any) => ({
        id: c.id,
        club_name: c.club_name ?? null,
        course_name: c.course_name ?? null,
        city: c.location?.city ?? null,
        state: c.location?.state ?? null,
        country: c.location?.country ?? null,
        address: c.location?.address ?? null,
        latitude: c.location?.latitude ?? null,
        longitude: c.location?.longitude ?? null,
        has_tees: !!(c.tees && Object.keys(c.tees).length > 0),
      }));

      // Upsert into Supabase
      const { error, count } = await supabase
        .from("golf_courses_cache")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: false })
        .select("id");

      if (error) {
        return NextResponse.json({
          error: error.message,
          stoppedAtPage: page,
          totalInserted,
        }, { status: 500 });
      }

      totalInserted += rows.length;
      page++;

      // Rate limit: delay between every request to avoid 429s
      await new Promise((r) => setTimeout(r, 150));
    }

    return NextResponse.json({
      message: "Seeding complete",
      totalInserted,
      totalPages: page - 1,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
