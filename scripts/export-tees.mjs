/**
 * Export course tee data to CSV for manual data entry.
 *
 * Usage:
 *   node scripts/export-tees.mjs                  # export ALL courses from cache
 *   node scripts/export-tees.mjs --missing-only   # only courses with incomplete tee data
 *   node scripts/export-tees.mjs --state CT        # filter by state
 *
 * Output: scripts/tees-export.csv
 *
 * The CSV has columns:
 *   course_api_id, club_name, course_name, city, state, tee_name, rating, slope, par, yards
 *
 * Hand this CSV to someone. They fill in blank rating/slope cells.
 * Then run: node scripts/import-tees.mjs scripts/tees-filled.csv
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

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

const args = process.argv.slice(2);
const missingOnly = args.includes("--missing-only");
const stateIdx = args.indexOf("--state");
const stateFilter = stateIdx !== -1 ? args[stateIdx + 1] : null;

function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function fetchWithRetry(url, headers, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const wait = 2000 * (attempt + 1);
      console.log(`  Rate limited, waiting ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  return null;
}

async function run() {
  // Fetch courses from cache
  let query = supabase
    .from("golf_courses_cache")
    .select("id, club_name, course_name, city, state")
    .eq("has_tees", true)
    .order("state")
    .order("club_name");

  if (stateFilter) {
    query = query.eq("state", stateFilter.toUpperCase());
  }

  const { data: courses, error } = await query.limit(5000);
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  console.log(`Found ${courses.length} courses with tees in cache${stateFilter ? ` (state: ${stateFilter})` : ""}`);

  const rows = [];
  let processed = 0;

  for (const course of courses) {
    // Fetch tee data from API
    const res = await fetchWithRetry(`${BASE_URL}/courses/${course.id}`, {
      Authorization: `Key ${API_KEY}`,
    });

    if (!res || !res.ok) {
      console.log(`  Skipping ${course.club_name} (API error ${res?.status})`);
      if (res?.status === 429) {
        console.log("  Rate limit hit hard — stopping. Run again later.");
        break;
      }
      continue;
    }

    const json = await res.json();
    const tees = json.course?.tees ?? json.tees ?? {};

    for (const [teeName, teeData] of Object.entries(tees)) {
      const t = teeData;
      const rating = t.course_rating ?? t.courseRating ?? null;
      const slope = t.slope ?? null;
      const par = t.par ?? null;
      const yards = t.total_yards ?? t.totalYards ?? null;

      if (missingOnly && rating != null && slope != null) continue;

      rows.push({
        course_api_id: course.id,
        club_name: course.club_name,
        course_name: course.course_name,
        city: course.city,
        state: course.state,
        tee_name: teeName,
        rating: rating ?? "",
        slope: slope ?? "",
        par: par ?? "",
        yards: yards ?? "",
      });
    }

    processed++;
    if (processed % 50 === 0) {
      console.log(`  Processed ${processed}/${courses.length} courses, ${rows.length} tee rows so far`);
    }

    // Throttle
    await new Promise((r) => setTimeout(r, 150));
  }

  // Write CSV
  const header = "course_api_id,club_name,course_name,city,state,tee_name,rating,slope,par,yards";
  const csvRows = rows.map((r) =>
    [r.course_api_id, r.club_name, r.course_name, r.city, r.state, r.tee_name, r.rating, r.slope, r.par, r.yards]
      .map(escapeCsv)
      .join(",")
  );

  const csv = [header, ...csvRows].join("\n");
  const outPath = missingOnly ? "scripts/tees-missing.csv" : "scripts/tees-export.csv";
  writeFileSync(outPath, csv);

  console.log(`\nDone! Wrote ${rows.length} tee rows to ${outPath}`);
  if (missingOnly) {
    console.log("These are the tees that need rating/slope filled in.");
  }
  console.log("Hand this CSV to someone to fill in blank rating/slope cells.");
  console.log("Then run: node scripts/import-tees.mjs <filled-csv-path>");
}

run().catch(console.error);
