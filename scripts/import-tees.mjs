/**
 * Import filled tee data CSV into a Supabase `course_tee_overrides` table.
 *
 * Usage:
 *   node scripts/import-tees.mjs scripts/tees-filled.csv
 *
 * Expected CSV columns:
 *   course_api_id, club_name, course_name, city, state, tee_name, rating, slope, par, yards
 *
 * This script:
 *   1. Creates the `course_tee_overrides` table if it doesn't exist
 *   2. Upserts all rows with non-empty rating+slope
 *
 * The app's ClubPicker can then merge these overrides with API data.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load .env.local
const envFile = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envFile.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) env[key.trim()] = rest.join("=").trim();
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars. Check .env.local");
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/import-tees.mjs <csv-path>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

async function run() {
  // Create table if needed
  const { error: createErr } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS course_tee_overrides (
        id BIGSERIAL PRIMARY KEY,
        course_api_id INTEGER NOT NULL,
        tee_name TEXT NOT NULL,
        rating NUMERIC(5,1),
        slope INTEGER,
        par INTEGER,
        yards INTEGER,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(course_api_id, tee_name)
      );
    `,
  });

  if (createErr) {
    console.log("Note: Could not auto-create table (may already exist or need manual SQL).");
    console.log("If the table doesn't exist, run this SQL in Supabase Dashboard:");
    console.log(`
      CREATE TABLE IF NOT EXISTS course_tee_overrides (
        id BIGSERIAL PRIMARY KEY,
        course_api_id INTEGER NOT NULL,
        tee_name TEXT NOT NULL,
        rating NUMERIC(5,1),
        slope INTEGER,
        par INTEGER,
        yards INTEGER,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(course_api_id, tee_name)
      );
    `);
  }

  // Parse CSV
  const raw = readFileSync(csvPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const header = lines[0];
  const dataLines = lines.slice(1);

  console.log(`Read ${dataLines.length} rows from ${csvPath}`);

  const rows = [];
  let skipped = 0;

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    // course_api_id, club_name, course_name, city, state, tee_name, rating, slope, par, yards
    const courseApiId = parseInt(cols[0]);
    const teeName = cols[5];
    const rating = cols[6] ? parseFloat(cols[6]) : null;
    const slope = cols[7] ? parseInt(cols[7]) : null;
    const par = cols[8] ? parseInt(cols[8]) : null;
    const yards = cols[9] ? parseInt(cols[9]) : null;

    if (!courseApiId || !teeName) { skipped++; continue; }
    if (rating == null && slope == null) { skipped++; continue; }

    rows.push({
      course_api_id: courseApiId,
      tee_name: teeName,
      rating,
      slope,
      par,
      yards,
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`Importing ${rows.length} tees with data (skipped ${skipped} incomplete rows)`);

  // Upsert in batches of 100
  const BATCH = 100;
  let imported = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("course_tee_overrides")
      .upsert(batch, { onConflict: "course_api_id,tee_name" });

    if (error) {
      console.error(`Error at batch ${i}:`, error.message);
      continue;
    }
    imported += batch.length;
  }

  console.log(`\nDone! Imported ${imported} tee overrides.`);
  console.log("The app will merge these with API data when players pick tees.");
}

run().catch(console.error);
