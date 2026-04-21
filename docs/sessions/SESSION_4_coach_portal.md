# Session 4 — Coach Portal + Slot Requests

**Status:** Complete (landed 2026-04-21)
**Goal:** Ship the coach portal, slot-request flow, admin approval queue, and transactional email via Resend. A coach can log in, request a weekend slot, and receive an email confirmation after admin approves it.

---

## Scope delivered

### Data model
- **New table:** `open_windows` (`org_id`, `field_id`, `day_of_week`, `start_time`, `end_time`, `notes`) with unique index on `(org_id, field_id, dow, start_time)` and RLS.
- **Seeded windows** for 885 Back Field: Fri 20:00–22:00, Sat 11:00–19:00, Sun 09:00–19:00.
- **Deleted** all pre-seeded `source='open_slot'` blocks (Session 1's placeholder rows). Seed no longer creates them.
- **Migration 0003:** added `field_id`, `start_at`, `end_at` to `slot_requests`, and made `requested_block_id` nullable. This was necessary because the Session 4 redesign moved `slot_requests` from "reference an existing block" to "describe an arbitrary time range"; Session 1's schema was wrong for the new model.

### Coach portal (`/coach`)
- Replaces the Session 1 placeholder.
- "Welcome, <name> · <team>" header with TJ black+gold styling.
- **Upcoming blocks:** team's future blocks (next 4 weeks) with a per-row Cancel button for future non-cancelled blocks.
- **Request a slot** form: field (default 885 Back), date (restricted to dates with an open window), duration (1h/1.5h/2h/2.5h/3h), start time (30-min increments that fit), optional note. Client component with live filtering; submits via server action.
- **Your pending requests:** list with Withdraw button per row.
- Error boundary (`app/coach/error.tsx`) surfaces server-action failures as human-readable messages.

### Admin approval queue (`/admin/requests`)
- Pending requests table with Approve + Deny buttons (Deny has an optional reason input).
- "Recently decided (last 7 days)" audit table below.
- Nav badge: `Requests (N)` count of pending, computed once in the admin layout.
- Approve action:
  1. Inserts `schedule_blocks` row with `source='manual'`, `status='confirmed'`, team_id from requester.
  2. Marks the request `approved`.
  3. Finds overlapping pending requests on the same field, marks them `denied` with `admin_note='superseded'`.
  4. Fires emails to the approved coach and each superseded coach.
- Deny action: marks request denied with optional reason, emails coach.

### Server-side helpers (`lib/requests/`)
- `windowsForDate(windows, fieldId, dateEt)` — pure filter by field + dow.
- `fitsInWindow(window, startAtUtc, endAtUtc)` — DST-safe ET range check.
- `validateSlotRequest(admin, orgId, input)` — five-gate server-only validator:
  1. end > start
  2. duration ≤ 3h
  3. 30-minute boundaries
  4. fits inside a defined open window for that field/day
  5. no overlap with existing `confirmed`/`tentative` blocks on that field
  6. no overlapping pending request from the same coach
- Unit tests cover all gates: DST edges, field mismatch, weekday mismatch, duration cap, overlap detection.

### Email notifications via Resend
- **New lib:** `lib/email/send.ts` — native-fetch wrapper over Resend's REST API. Sender: `noreply@poweryourleague.com`.
- **New lib:** `lib/notifications/enqueue.ts` — `notifyRequestSubmitted`, `notifyRequestApproved`, `notifyRequestDenied`. Each function inserts a row in `notifications` (status=pending), sends via Resend, then updates the row to sent/failed.
- **New env var:** `RESEND_API_KEY` — same key works for both our server-side sends AND Supabase Auth's SMTP password (one key covers both flows).
- Admin email triggers: on request submit.
- Coach email triggers: on approve, deny, or supersede.
- All attempts logged to `notifications` for audit.

### Admin nav updates
- Added "Requests" link with pending-count badge in gold.
- Active-state styling works across all admin sub-routes.

## Bugs caught during implementation

1. **Schema mismatch in `slot_requests`** — Session 1 schema assumed requests referenced pre-existing open_slot blocks via `requested_block_id` (NOT NULL). Session 4 redesign has requests describing arbitrary time ranges. Missed this in the Session 4 design spec. Fixed with migration 0003: added `field_id`, `start_at`, `end_at` columns; dropped NOT NULL on `requested_block_id`. Surfaced as a "Server Components render" error on the first real slot-request attempt.
2. **Resend API keys are one-shot** — user accidentally deleted the old key (used for Supabase Auth SMTP) while creating a new one for server-side sends. Fix: one key works for both; the new key's value was pasted back into Supabase Auth's SMTP password field.
3. **`.env.local` not auto-saving** — VSCode showed the file as modified but the key was length=0 on disk until Cmd+S. Same pattern as Session 1.

## New files

```
supabase/migrations/
  0002_open_windows.sql
  0003_slot_requests_fields.sql

lib/
  email/send.ts
  notifications/enqueue.ts
  requests/
    windows.ts
    windows.test.ts
    validate.ts

app/
  admin/
    _actions.ts                     (modified — added approveSlotRequest, denySlotRequest)
    _components/admin-nav.tsx       (modified — added Requests + pending-count badge)
    layout.tsx                      (modified — fetches pending count)
    requests/page.tsx               (new)
  coach/
    _actions.ts                     (new — submitSlotRequest, withdrawSlotRequest, cancelOwnBlock)
    _components/
      request-form.tsx              (new, client)
      upcoming-block-row.tsx        (new)
      pending-request-row.tsx       (new)
    page.tsx                        (rewritten)
    error.tsx                       (new)
```

## Env vars

- **New:** `RESEND_API_KEY` — set in `.env.local` and pushed to Vercel production.

## What's live

- **Prod:** https://fields.poweryourleague.com
- **Deployment commits to note:**
  - `abe7090` — coach portal + admin queue + badge
  - `8b84ef0` — slot_requests schema fix (migration 0003)

## Verification checklist

- [x] Migration 0002 applied; `open_windows` has 3 rows for 885 Back
- [x] Migration 0003 applied; `slot_requests` has field_id/start_at/end_at columns
- [x] Coach portal loads; upcoming blocks render
- [x] Slot request form filters dates to those with an open window
- [x] Request insert succeeds and notification is logged + sent
- [x] Admin `/admin/requests` shows pending count in nav
- [x] Approve creates a confirmed block, sends email
- [x] Deny marks the request, sends email
- [x] Coach portal shows pending requests with Withdraw
- [x] Future block cancellation works from coach view

## What's NOT in Session 4

- SMS notifications (Session 5)
- Rec-override-travel flow (Session 5)
- Coach calendar/week-grid view (list view is sufficient for MVP)
- Self-serve auto-approval (admin approves every request)
- Bulk approve/deny
- Recurring-slot CRUD in the UI (admin edits via SQL)

## Manual steps for Meesh

- Tell the 4 other travel coaches (Hennessy, Ackerman, Foster, Motycki) they can log in at `https://fields.poweryourleague.com/coach` with their email. First login populates their `auth_user_id` automatically.

## Session 5 preview

Override flow + SMS via Twilio:
- Admin can mark a travel block "overridden for rec makeup" — creates a replacement rec block with `overridden_by_block_id` link, moves the travel block to `status='overridden'`.
- Affected travel coach gets an SMS within 10 seconds.
- Twilio wired behind a `lib/sms/send.ts` in the same shape as `lib/email/send.ts`.
- Dev/test/prod modes to avoid real SMS during testing.

No Session 4 loose ends that block Session 5.
