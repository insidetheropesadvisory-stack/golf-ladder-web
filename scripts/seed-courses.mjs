import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load .env.local
const envFile = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envFile.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) env[key.trim()] = rest.join("=").trim();
}

const API_KEY = env.GOLF_COURSE_API_KEY;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = "https://api.golfcourseapi.com/v1";

if (!API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env vars. Check .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seed() {
  let page = 1;
  let total = 0;

  // Resume from arg if provided
  if (process.argv[2]) page = parseInt(process.argv[2]);

  console.log(`Starting seed from page ${page}...`);

  while (true) {
    // Fetch with retry
    let res = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(`${BASE_URL}/courses?page=${page}`, {
        headers: { Authorization: `Key ${API_KEY}` },
      });
      if (res.status === 429) {
        const wait = 3000 * (attempt + 1);
        console.log(`  Rate limited on page ${page}, waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      break;
    }

    if (!res || !res.ok) {
      console.log(`Stopped at page ${page} (status ${res?.status})`);
      break;
    }

    const data = await res.json();
    const courses = data.courses ?? [];
    if (courses.length === 0) break;

    const rows = courses.map((c) => ({
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

    const { error } = await supabase
      .from("golf_courses_cache")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: false });

    if (error) {
      console.error(`Error at page ${page}:`, error.message);
      break;
    }

    total += rows.length;
    if (page % 50 === 0) {
      console.log(`  Page ${page} — ${total} courses seeded so far`);
    }

    page++;

    // Throttle to avoid rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone! Seeded ${total} courses (pages 1–${page - 1})`);
}

seed().catch(console.error);
