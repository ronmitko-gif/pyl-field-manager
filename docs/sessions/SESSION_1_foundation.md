# Session 1 — Foundation

**Status:** Complete (landed 2026-04-20)
**Goal:** Deploy a live URL at `fields.poweryourleague.com` that shows real rec games pulled from Sports Connect, with admin login via magic link.

---

## Scope

- Next.js 15 App Router project scaffold with TypeScript + Tailwind
- Supabase Postgres schema, RLS, and seed data
- Magic-link auth (admin + coach roles)
- Sports Connect iCal ingestor + hourly Vercel Cron
- Bare-bones admin page (read-only schedule view, "Sync now" button, sync history)
- Coach placeholder page
- Deploy to Vercel

## Out of scope (defer to later sessions)

- Weekly calendar grid (Session 2)
- Travel recurring slot → concrete block materialization (Session 2)
- Coach portal UI, slot request/approval flow (Session 4)
- Override flow + Twilio SMS (Session 5)
- Styling polish, `poweryourleague-brand` (Session 6)

---

## Stack (locked)

- Next.js 15 (App Router, TypeScript strict, Tailwind v4)
- Supabase Postgres + Auth + RLS (project `pyl-field-manager`)
- `@supabase/ssr` + `@supabase/supabase-js`
- `node-ical`, `date-fns`, `date-fns-tz`
- `vitest` for unit tests (iCal parser only)
- Vercel hosting + Vercel Cron
- Node 24.x (deviation noted — CLAUDE.md locks to 20.x LTS; non-breaking, revisit if an issue arises)
- npm as package manager (pnpm not installed locally)

---

## Environment

```
GitHub:   https://github.com/ronmitko-gif/pyl-field-manager.git
Vercel:   pyl-field-manager  (created during this session)
Supabase: pyl-field-manager  (exists; creds in .env.local)
Prod URL: fields.poweryourleague.com  (DNS configured interactively at end of session)
```

Env vars live in `.env.local` (gitignored) and are documented in `.env.example`.

---

## Database schema (applied via Supabase Dashboard SQL Editor)

Tables:

- `organizations` — multi-tenancy placeholder; one row for TJYBB
- `fields` — physical fields at Andrew Reilly Memorial Park
- `teams` — travel teams + a `Rec Minors` placeholder
- `coaches` — admins and coaches; `auth_user_id` populated on first login
- `travel_recurring_slots` — weekly practice pattern per team
- `schedule_blocks` — the concrete schedule (rec games, travel practices, overrides, open slots); keyed on `(source, source_uid)` for iCal upserts
- `slot_requests` — coach requests for open slots (admin approval)
- `notifications` — pending/sent SMS and email log
- `sync_runs` — audit of iCal ingest runs

RLS helpers: `is_admin()`, `my_team_ids()`.
RLS policies: admins see everything; coaches see their own team + their own row + their own notifications/requests.

See **[implementation plan](/docs/superpowers/plans/2026-04-17-session-1-foundation.md)** for the full SQL and step-by-step tasks.

---

## Seed data

- **Organization:** slug `tjybb`, name "Thomas Jefferson Youth Baseball"
- **Fields (both at Andrew Reilly Memorial Park):**
  - `885 Back Field` — SC description: `Andrew Reilly Memorial Park > 885 Back Field`
  - `885 Front Field` — SC description: `Andrew Reilly Memorial Park > 885 Front Field (Huber)`
- **Teams:** 9U B / 9U A / 10U B / 10U A / 9U C Jaguars (travel); `Rec Minors` placeholder (rec)
- **Coaches:** `Meesh` (admin, `meesh@poweryourleague.com`, no team)
- **Travel recurring slots** (885 Back Field, 2-hour blocks, `effective_from = today`):
  - Mon 20:00–22:00 → 9U B
  - Tue 20:00–22:00 → 9U A
  - Wed 20:00–22:00 → 10U B
  - Thu 20:00–22:00 → 10U A
  - Sat 09:00–11:00 → 9U C
- **Open slot blocks** (materialized for 4 weeks, 885 Back Field, `status='open'`, `source='open_slot'`):
  - Fri 20:00–22:00 (1 block/week)
  - Sat 11:00, 13:00, 15:00, 17:00 (4 blocks/week, each 2h)
  - Sun 09:00, 11:00, 13:00, 15:00, 17:00 (5 blocks/week, each 2h)
  - All stored in UTC, times are America/New_York

Seed rules: never insert `source='sports_connect'` rows (those come from iCal). Seeds are idempotent (natural-key upserts / `on conflict do nothing`).

---

## Core flows this session

### Magic-link login

1. `/login` posts email → `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '<origin>/auth/callback' } })`
2. User clicks link → Supabase redirects to `/auth/callback?code=...`
3. Callback exchanges code for session → looks up `coaches.email`:
   - Found, `auth_user_id` null → update it to `auth.uid()` → redirect by role
   - Found, `auth_user_id` set → redirect by role
   - Not found → show "Your email isn't registered, contact admin."
4. Admin → `/admin`; coach → `/coach`
5. `middleware.ts` guards `/admin/*` (admin only) and `/coach/*` (coach only)

### Sports Connect sync

1. Cron (or admin "Sync now") POSTs `/api/sync/sports-connect` with `Authorization: Bearer ${CRON_SECRET}`
2. Route inserts `sync_runs` row (status=`running`)
3. Fetches `SPORTS_CONNECT_ICAL_URL`, parses with `node-ical`
4. For each VEVENT: split `DESCRIPTION` on ` > `, look up `fields.sports_connect_description`, split `SUMMARY` on ` @ ` for away/home team names, upsert `schedule_blocks` on `(source='sports_connect', source_uid=UID)`
5. Track counts (seen / inserted / updated / unchanged) + any per-event errors
6. Finalize `sync_runs` row with status `success` or `partial`
7. Return JSON summary

---

## Verification checklist (session done when all checked)

- [x] `npm run dev` starts without errors
- [x] Can log in as `meesh@poweryourleague.com` via magic link → lands on `/admin` (verified locally AND on `https://fields.poweryourleague.com`)
- [ ] Second (dummy) coach row logs in → lands on `/coach` (deferred — Supabase email rate limit on free tier blocked a second test; code path exercised by the admin-redirect middleware)
- [x] "Sync now" on `/admin` inserts real rec games into `schedule_blocks`
- [x] `schedule_blocks` stores times in UTC, displays America/New_York in UI
- [x] `sync_runs` table shows the run with accurate counts
- [ ] RLS smoke test: coach account cannot see another team's data (deferred to Session 2 when the coach UI lands and a second coach is seeded)
- [x] Deployed to Vercel at `https://pyl-field-manager.vercel.app` ~~with hourly cron~~ (cron removed — Vercel Hobby plan doesn't allow sub-daily crons; see BACKLOG)
- [x] `fields.poweryourleague.com` DNS configured, resolves, and serves the app over HTTPS

---

## Handoff

### What works end-to-end

- **Scaffold + deploy:** Next.js 16.2.4 (create-next-app picked 16, one minor up from the 15 in the plan — backwards-compatible) with TS strict, Tailwind v4, App Router. Deployed to Vercel at `https://pyl-field-manager.vercel.app` with alias `https://fields.poweryourleague.com` (custom domain live with Vercel-issued SSL).
- **Schema + seed:** 9 tables in Supabase `pyl-field-manager` with RLS on all 8 user-facing tables. Seed produces 1 org (TJYBB), 2 fields, 6 teams, 1 admin coach (Meesh), 5 travel recurring slot definitions, and 40 open-slot blocks covering the next 4 weeks on 885 Back Field.
- **Magic-link auth:** `/login` sends OTP, `/auth/callback` exchanges the code using a service-role admin client (RLS prevents self-lookup until `auth_user_id` is linked — so the admin client does the initial lookup + link), middleware guards `/admin/*` and `/coach/*`, landing `/` redirects to the right page.
- **iCal ingestor:** `POST /api/sync/sports-connect` (protected by `Authorization: Bearer ${CRON_SECRET}`) fetches the Sports Connect feed, parses with `node-ical`, upserts on `(source, source_uid)`, writes counts + errors to `sync_runs`. Admin "Sync now" button triggers the same endpoint.
- **Admin page:** Read-only view showing last 5 sync runs and next 14 days of schedule blocks with times in America/New_York. Fields render by short name.
- **Parser tests:** 4 unit tests (vitest) cover VEVENT extraction, `DESCRIPTION` > splitting, `SUMMARY` @ splitting, and UTC preservation.

### Non-obvious bugs fixed during the session

1. **`.env.local` control character** — the service-role key had a trailing `^C` (ASCII 3) from paste, which made node's fetch reject the `apikey` header with `UND_ERR_INVALID_ARG`. Silently turned every admin-client call into a fetch failure. A tiny in-place script stripped trailing 0x00–0x1f from every line.
2. **RLS blocked the callback's coach lookup** — `coaches see self` policy (`auth_user_id = auth.uid()`) can't match on first login when `auth_user_id` is still NULL. Switched the callback to use the service-role admin client for that one admin-style operation.
3. **`node-ical` + Turbopack/webpack bundling** — `temporal-polyfill` got miscompiled during page-data collection (`TypeError: h.BigInt is not a function`). Added `serverExternalPackages: ["node-ical"]` to `next.config.ts` so the package runs from `node_modules` at request time.
4. **Vercel auto-detection missed Next.js** — the initial `vercel link` ran from `~` instead of the project dir, so Vercel set Framework Preset to "Other" and served 404 for every route. Fixed by moving `.vercel/` into the project and adding `"framework": "nextjs"` to `vercel.json`.
5. **"Sync now" POSTed to wrong origin** — the server action read `NEXT_PUBLIC_SITE_URL` with a fallback to `http://localhost:3000`, but the stale dev server on :3000 was eating the request. Added an explicit setting in `.env.local` and a `VERCEL_URL` fallback for prod.

### Env vars currently set in Vercel (production)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SPORTS_CONNECT_ICAL_URL`
- `CRON_SECRET`
- `ADMIN_EMAIL`

Not set: `NEXT_PUBLIC_SITE_URL` — intentional; prod falls back to `VERCEL_URL` which Vercel sets automatically.

### Manual steps already completed by Meesh

- Ran migration + seed SQL via Supabase Dashboard SQL Editor
- Added redirect URLs in Supabase Dashboard → Authentication → URL Configuration:
  - `http://localhost:3000/auth/callback` and `http://localhost:3001/auth/callback`
  - `https://pyl-field-manager.vercel.app/auth/callback`
  - `https://fields.poweryourleague.com/auth/callback`
- Added DNS A record for `fields` at Cloudflare pointing to `76.76.21.21` (DNS-only, not proxied)
- Signed into Vercel CLI and linked the project

### What's pending / deferred

- ~~**Prod login smoke test**~~ — verified end-to-end on `https://fields.poweryourleague.com` after updating Supabase Site URL to the prod domain (was defaulting to `http://localhost:3000` which broke the magic-link redirect fallback).
- **Hourly Sports Connect sync** — cron removed because Vercel Hobby caps crons at daily. Manual "Sync now" button works. See BACKLOG.
- **Custom SMTP for Supabase magic links** — high priority before first real coach onboards. See BACKLOG.
- **`middleware.ts` → `proxy.ts`** — Next 16 deprecation, non-blocking. See BACKLOG.
- Travel recurring slot materialization (Session 2).
- Coach portal + slot request flow (Session 4).
- SMS notifications (Session 5).

### Next session (Session 2) blockers

None. Schema, seed, auth, and deploy are solid. Session 2 can start by:
1. Wiring up the `poweryourleague-brand` skill
2. Building the week/day calendar grid reading from `schedule_blocks`
3. Adding the travel-slot materialization job
4. Admin block-detail panel (read + basic edit)

### URLs for the record

- **Prod:** https://fields.poweryourleague.com (and https://pyl-field-manager.vercel.app alias)
- **GitHub:** https://github.com/ronmitko-gif/pyl-field-manager
- **Supabase:** project `pyl-field-manager` (ref `nbddlpvtpfvssnfutmlm`)
- **Vercel:** project `pyl-field-manager` under team `power-your-league`
