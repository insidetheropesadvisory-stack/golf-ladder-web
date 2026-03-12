# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `npm run dev` (Next.js with Turbopack)
- **Build:** `npm run build`
- **Lint:** `npm run lint` (ESLint 9 flat config with next/core-web-vitals + typescript)
- **No test runner configured**

## Architecture

Next.js 16 App Router deployed on Vercel. Supabase for auth and database. Tailwind CSS v4 for styling. No external UI library — custom Tailwind-based design system.

### Auth & route protection

No `middleware.ts`. Auth is handled entirely in `AppShell` (client component) via `supabase.auth.onAuthStateChange()`. Unauthenticated users are redirected to `/login`. AppShell also enforces profile completeness (display_name + club membership required before proceeding).

### Supabase clients (`src/lib/supabase/`)

- `browser.ts` — `createSupabaseBrowserClient()` for client components
- `server.ts` — three exports:
  - `createSupabaseServerClient()` — cookie-based server client (Server Components, Server Actions)
  - `getAuthedUser(request)` — authenticates API route requests via Bearer token or cookie fallback
  - `adminClient()` — service role client that bypasses RLS (use in API routes for cross-user operations)

### Data flow pattern

- **Reads:** Client components use `supabase` browser client for direct DB reads (matches, profiles, ladder)
- **Writes:** POST to API routes with Bearer token → API routes use `getAuthedUser()` + `adminClient()` for RLS-bypassing mutations
- **Notifications:** Hybrid push + polling. Service Worker listens for push events and posts `{ type: 'PUSH_RECEIVED' }` to clients. AppShell falls back to polling `/api/notifications` every 60s if push unavailable.

### API routes

All API routes live under `src/app/api/`. They authenticate with `getAuthedUser(request)` from `@/lib/supabase/server` and use `adminClient()` for database writes that need to bypass RLS.

### Key route groups

```
/                        — Home dashboard (matches, stats, tournaments, pool)
/matches/new             — Match creation
/matches/[id]            — Match detail + scoring
/compete                 — Hub: ladder, tournaments, matches
  /ladder                — Rankings + challenge system (gross/net tiers)
  /ladder/challenge/[id] — Challenge detail + scoring
  /tournaments/[id]      — Tournament detail + rounds
/find-a-match            — Hub: pool listings
  /pool                  — Open listings, upcoming, completed
  /pool/[id]             — Pool detail + applications
/players/[id]            — Player profile + H2H stats
/profile                 — Current user settings
/badges                  — Achievement gallery
/onboarding              — 4-step profile setup
```

### Match system

Two formats: **stroke play** and **match play**. Two modes: **same-course** and **different-courses**.

- `matches` table: `creator_id`, `opponent_id`, `status` (proposed/active/completed), `format`
- Same-course: shared `holes` table (`match_id, hole_no, player_id, strokes`)
- Different-courses: `match_rounds` + `match_holes` (each player plays own course/tee)
- Scoring helpers in `src/app/matches/[id]/lib.ts`: `buildStrokeHoles()` (USGA handicap distribution), `matchPlayResult()`, `matchPlayNetResult()`, `calcDifferential()`
- Match completion: validates both players scored all holes, computes winner server-side, triggers ladder swap if `is_ladder_match=true`

### Ladder

- `ladder_rankings` table: `user_id, position, type` (gross/net)
- Challenge within 3 spots above → win to swap positions, decline to drop one spot
- Two tiers: gross (everyone) + net (only if `use_handicap=true`)

### Tournaments

- `tournaments` table with `period_type` (weekly/monthly) and `period_count`
- `tournament_rounds` table: one best round per period per user at any course
- Winner: lowest total differential across all periods

### Pool (Find a Match)

- `pool_listings` table: course, date, slots, guest fee, auto-accept toggle
- Credit system: users start with 3 tees. 1 consumed per guest play, 1 earned by host per confirmed guest
- Attestation time-gating: 3h15m for 18-hole, 1h35m for 9-hole rounds to prevent fraud
- Distance filtering via Nominatim geocoding of user's city/state

### Badge system (`src/lib/badges/`)

- Categories: compete, tournaments, handicap, social, participation
- Tiers: brass → silver → gold → black
- `evaluateUser()` called fire-and-forget after match completion — not blocking
- Checks criteria against badge definitions, creates notifications for newly earned badges

### Shared components

`src/app/components/` contains app-wide components:
- `AppShell` — wraps all pages (auth state, notifications, pool attestations, navigation)
- `BottomNav` / `TopNav` — navigation chrome
- `ClubPicker` — golf club search from 4 sources: user clubs, DB clubs, hardcoded CT_CLUBS, Golf Course API
- `OpponentPicker` — player search for match creation

### Styling

Tailwind CSS v4 with CSS custom properties defined in `src/app/globals.css`:
- `--pine` (deep green), `--paper` / `--paper-2` (ivory backgrounds), `--ink` (near-black text)
- `--muted`, `--border`, `--shadow`, `--shadow-sm`, `--brass` (accent)

### Key utilities (`src/lib/utils.ts`)

- `cx()` — classname joiner (like clsx)
- `initials()` — extract initials from a name
- `emailToName()` — convert email to display name

### Path alias

`@/*` maps to `./src/*` (configured in tsconfig.json).

### PWA & push notifications

- Service worker registered via `ServiceWorker` component. Manifest at `public/manifest.json`.
- Push: `web-push` package with VAPID keys. Subscriptions stored in `push_subscriptions` table.
- `sendPushToUser()` in `src/lib/pushSend.ts` batch-sends to all user subscriptions, cleans up expired (404/410).
- `public/sw.js`: precaches key pages, cache-first for static assets, network-first for pages.

### Database migrations

SQL migration scripts in `scripts/`. Run manually against Supabase. `seed-courses.mjs` populates the `golf_courses_cache` table from the external Golf Course API.

## Environment variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project
- `SUPABASE_SERVICE_ROLE_KEY` — for admin client (server-side only)
- `GOLF_COURSE_API_KEY` — golfcourseapi.com
- `RESEND_API_KEY`, `INVITE_FROM_EMAIL` — email sending
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — web push (optional)
