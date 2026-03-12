# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `npm run dev` (Next.js with Turbopack)
- **Build:** `npm run build`
- **Lint:** `npm run lint` (ESLint 9 flat config with next/core-web-vitals + typescript)
- **No test runner configured**

## Architecture

Next.js 16 App Router deployed on Vercel. Supabase for auth and database. Tailwind CSS v4 for styling.

### Supabase clients (`src/lib/supabase/`)

- `browser.ts` — `createSupabaseBrowserClient()` for client components
- `server.ts` — three exports:
  - `createSupabaseServerClient()` — cookie-based server client (Server Components, Server Actions)
  - `getAuthedUser(request)` — authenticates API route requests via Bearer token or cookie fallback
  - `adminClient()` — service role client that bypasses RLS (use in API routes for cross-user operations)

### API routes

All API routes live under `src/app/api/`. They authenticate with `getAuthedUser(request)` from `@/lib/supabase/server` and use `adminClient()` for database writes that need to bypass RLS.

### Shared components

`src/app/components/` contains app-wide components:
- `AppShell` — wraps all pages (auth state, navigation)
- `BottomNav` / `TopNav` — navigation chrome
- `ClubPicker` — golf club search with multiple data sources
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

### PWA

Service worker registered via `ServiceWorker` component. Manifest at `public/manifest.json`. Web push via `web-push` package, send logic in `src/lib/pushSend.ts`.

### Database migrations

SQL migration scripts in `scripts/`. Run manually against Supabase. `seed-courses.mjs` populates the `golf_courses_cache` table from the external Golf Course API.

## Environment variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project
- `SUPABASE_SERVICE_ROLE_KEY` — for admin client (server-side only)
- `GOLF_COURSE_API_KEY` — golfcourseapi.com
- `RESEND_API_KEY`, `INVITE_FROM_EMAIL` — email sending
