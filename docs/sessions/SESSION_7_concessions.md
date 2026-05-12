# Session 7 — Concession Stand Sign-Ups

**Status:** Complete (landed 2026-04-27)
**Goal:** Public volunteer sign-up flow at `/concessions` — auto-generated front-field game shifts + manual tournament events — with email confirmation, tokenized cancel, day-of reminder.

---

## Scope delivered

- **Migration 0005:** `concession_events`, `concession_slots`, `concession_signups` tables. Capacity trigger enforces no over-signups at DB level. Partial unique index prevents one email claiming the same slot twice. Public RLS read on all three; admin full access.
- **Dual iCal feeds:** new `SPORTS_CONNECT_ICAL_MINORS` (= old URL) + `SPORTS_CONNECT_ICAL_MAJORS`. Existing `SPORTS_CONNECT_ICAL_URL` retained as fallback alias. Sync route now calls `fetchAndParseManyIcal` and dedups on UID.
- **Slot generation (TDD):** `lib/concessions/generate.ts` — pure function turns front-field game blocks into one event per date with merged-overlap 2-hour slots starting 30 minutes before each game. 4 unit tests cover singles, multi-game days, overlap merging, and ET date separation.
- **Cron route `/api/cron/generate-concessions`:** runs hourly via existing GitHub Actions workflow. Idempotent — only inserts events that don't yet exist for a given date.
- **Public pages:**
  - `/concessions` — list of upcoming events (auto-refreshed every 60s)
  - `/concessions/[eventId]` — slot grid with "Claim" buttons opening a name+email modal
  - `/concessions/cancel/[token]` — cancellation landing page (works on first visit)
- **Public API routes:**
  - `POST /api/concessions/claim` — validates name + email, inserts signup, sends confirmation email
  - `POST /api/concessions/cancel` — soft-cancels via token, sends cancellation email
- **Email templates:** `lib/email/concession-templates.ts` — confirmation / reminder / cancellation HTML strings, all branded "TJYBB Concessions".
- **Daily reminders:** new GitHub Actions workflow `daily-reminders.yml` runs at `12:00 UTC` (8 AM ET in EDT), calls `POST /api/cron/send-reminders` which emails any signups whose slot is today and that haven't been reminded yet.
- **Admin:**
  - `/admin/concessions` — list of events + new-tournament form
  - `/admin/concessions/[eventId]` — slot detail + remove-signup buttons + Export CSV link
  - `GET /api/concessions/export/[eventId]` — admin-only CSV download
- **CSV helper:** `lib/concessions/csv.ts` with proper escaping (quotes commas/quotes), 2 unit tests.
- **Admin nav:** added "Concessions" link.

## Design deviations from the spec

| Spec said | What we shipped | Reason |
|---|---|---|
| Twilio SMS confirmation / reminder / cancel | Email-only via Resend | Twilio not live in prod and email already wired (Session 4). Meesh's explicit call. |
| Phone number normalization to E.164 | Email validation instead | Same reason. |
| `LOCATION` regex matcher with `FRONT_FIELD_PATTERNS` | `field_id = <Front Field row id>` | Our existing ingestor already maps DESCRIPTION → `fields` row. Simpler, no fragile regex. |
| `source_location` debugging column | Still in the schema but unused | Reserved for future use. |
| Phone column on `concession_signups` | `volunteer_email` column | Email-only call. |

## New env vars

- `SPORTS_CONNECT_ICAL_MINORS` — moved from `SPORTS_CONNECT_ICAL_URL` (the old name still works as alias)
- `SPORTS_CONNECT_ICAL_MAJORS` — Sports Connect Majors division calendar URL

Both set in Vercel production and in `.env.local`.

## Files added this session

```
supabase/migrations/0005_concessions.sql
lib/concessions/generate.ts
lib/concessions/generate.test.ts
lib/concessions/csv.ts
lib/concessions/csv.test.ts
lib/email/concession-templates.ts
app/concessions/page.tsx
app/concessions/[eventId]/page.tsx
app/concessions/cancel/[token]/page.tsx
app/concessions/_components/event-card.tsx
app/concessions/_components/slot-row.tsx
app/concessions/_components/claim-form.tsx
app/admin/concessions/page.tsx
app/admin/concessions/[eventId]/page.tsx
app/admin/concessions/_actions.ts
app/admin/concessions/_components/new-tournament-form.tsx
app/api/concessions/claim/route.ts
app/api/concessions/cancel/route.ts
app/api/concessions/export/[eventId]/route.ts
app/api/cron/generate-concessions/route.ts
app/api/cron/send-reminders/route.ts
.github/workflows/daily-reminders.yml
concession-signups-spec.md           (Meesh's original spec, committed for posterity)
docs/superpowers/specs/2026-04-22-session-6-public-view-and-polish-design.md (still — Session 6 already)
docs/superpowers/plans/2026-04-27-session-7-concession-signups.md
docs/sessions/SESSION_7_concessions.md
```

## Verification checklist

- [x] `/concessions` serves 200 publicly (no auth)
- [x] Public claim form submits → email arrives (verify in your inbox)
- [x] Cancel link in email → cancellation page + cancellation email
- [x] Admin can create a tournament and see it on the public list
- [x] Admin can remove a signup
- [x] CSV export downloads a valid file
- [ ] Game-day events auto-materialize on the next hourly sync (run `workflow_dispatch` on `hourly-sync.yml` to confirm immediately)
- [ ] Day-of reminder fires at 12:00 UTC for a slot whose `start_at` is today (will fire automatically tomorrow at 8 AM ET; or `workflow_dispatch` on `daily-reminders.yml` to test now)

## Manual May 16 seed

Once you've verified the flow on a test event, create the May 16 tournament:

1. Visit `https://fields.poweryourleague.com/admin/concessions`
2. New tournament — Date `2026-05-16`, Start `9`, End `18`, Capacity `2`
3. Click "Create tournament" — redirects to the event detail with 9 slots × 2 capacity = 18 spots
4. Share the public URL with the team: `https://fields.poweryourleague.com/concessions/<event-id>`

## What's NOT in Session 7

- SMS notifications (Twilio deferred per Meesh's call)
- Phone-number contact column (email-only)
- Reschedule / move flow if a previously-synced game gets moved off the front field — spec mentioned auto-cancelling and notifying, but we deferred this since the auto-override logic from Session 5 already deletes stale `source='sports_connect'` rows on the next sync. **Open issue:** if a stale row has slots and signups, those orphan with no notification. Worth revisiting if it happens.
- Per-event admin reminder trigger (use `workflow_dispatch` on the daily workflow instead)
- Public unmatched-LOCATION debug view (no regex needed thanks to field_id match)

## Next session preview

No Session 8 spec on file yet. Possibilities when Meesh is ready:
- SMS layer for concession + slot-request + override flows (if Twilio gets paid)
- PYL multi-tenant port (post-spring-season)
- Custom domain emails (e.g., `tjybb@poweryourleague.com` from address) and email branding
- Calendar export from `/schedule` for parents (.ics download)
- Photo gallery / fundraising integration
