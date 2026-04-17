# Session 1 — Foundation

**Status:** In progress (started 2026-04-17)
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

- [ ] `npm run dev` starts without errors
- [ ] Can log in as `meesh@poweryourleague.com` via magic link → lands on `/admin`
- [ ] Second (dummy) coach row logs in → lands on `/coach`
- [ ] "Sync now" on `/admin` inserts real rec games into `schedule_blocks`
- [ ] `schedule_blocks` stores times in UTC, displays America/New_York in UI
- [ ] `sync_runs` table shows the run with accurate counts
- [ ] RLS smoke test: coach account cannot see another team's data (verified in Supabase SQL editor)
- [ ] Deployed to Vercel; hourly cron scheduled and visible in Vercel dashboard
- [ ] `fields.poweryourleague.com` DNS configured and resolves to the Vercel deployment

---

## Handoff (filled in at end of session)

_What works:_
_What doesn't:_
_Env vars Meesh needs to set in Vercel:_
_Manual steps Meesh must do:_
_Next session blockers (if any):_
