# Session 5 — Override Flow + Twilio SMS (Design)

**Date:** 2026-04-21
**Status:** Design approved; ready for implementation plan.
**Roadmap slot:** Session 5 per `SCOPE.md §9`.

---

## Goal

Give Meesh a one-click "override this travel practice for a rec makeup" action, and layer Twilio SMS on top of Session 4's Resend emails so time-sensitive notifications reach coaches whether or not they check email. Add an admin notifications log for delivery visibility.

## Non-goals

- Re-overriding an already-overridden block — one-and-done; SQL fix for mistakes
- Un-override button — admin can delete the override block + manually reset the travel block via SQL if needed
- Two-way SMS / replies
- Notification resend button
- Rich phone-number validation (we accept whatever admin enters; Twilio rejects invalid ones at send time)

---

## Decisions made during brainstorming

- **SMS + email for every event** (when coach has a phone number). Email-only fallback if `coaches.phone` is null. Redundancy matters for overrides because they're time-sensitive.
- **Three Twilio modes** (`dev` | `test` | `prod`) via `TWILIO_MODE` env var. Dev mode logs to console without hitting Twilio — avoids burning test credits during local dev.
- **Override UX:** inline form in the existing `BlockDrawer`, not a separate page. Matches existing admin-flow pattern.

---

## Units

### Unit 1 — Twilio SMS library

**New env vars** (add to `.env.local` and Vercel prod):
- `TWILIO_ACCOUNT_SID` — from Twilio console
- `TWILIO_AUTH_TOKEN` — from Twilio console (rotate if leaked)
- `TWILIO_FROM_NUMBER` — E.164, e.g. `+14125550123`
- `TWILIO_MODE` — `dev` | `test` | `prod`, defaults to `prod` when unset

**New lib:** `lib/sms/send.ts`

```typescript
type SmsInput = { to: string; body: string };
type SendResult = { ok: true; id: string } | { ok: false; error: string } | { ok: true; id: 'dev-logged' };

export async function sendSms(input: SmsInput): Promise<SendResult>;
```

Implementation:
- `dev` mode: `console.log('[sms/dev] to=%s body=%s', input.to, input.body)`, return `{ ok: true, id: 'dev-logged' }`.
- `test` mode: POST to Twilio with the test AccountSid/AuthToken and `FromNumber='+15005550006'` (Twilio's magic "valid" number for tests). Roundtrip, no real SMS.
- `prod` mode: POST to Twilio real endpoint with the real creds.
- Uses native `fetch`, no npm dep.

**Rate of failure on bad inputs:** Twilio rejects invalid phone numbers with 400; we treat any non-2xx as `{ ok: false, error }` and surface in notifications table.

### Unit 2 — Notifications enqueue changes

Extend `lib/notifications/enqueue.ts`:

- Add a helper `persistAndSendSms(admin, params)` parallel to the existing `persistAndSend` for email.
- If `coach.phone` is null/empty: insert a `notifications` row with `channel='sms'`, `status='skipped'`, skip the Twilio call.
- If phone is present: insert a row with `status='pending'`, call `sendSms`, update the row.

Modify existing functions to send BOTH email and SMS:
- `notifyRequestSubmitted` — admin gets email only (admins may or may not have phones; keep SMS limited to coaches for now).
- `notifyRequestApproved` — coach gets email AND SMS.
- `notifyRequestDenied` — coach gets email AND SMS.

Add new function:
- `notifyTravelOverridden(admin, orgId, overriddenBlock, replacementBlock, reason, teamCoaches, fieldName)` — sends email + SMS to each coach on the overridden team.

**SMS templates (plain text, keep under 160 chars):**

- Approve: `PYL: your ${fieldShortName} slot on ${date} ${time} is confirmed.`
- Deny: `PYL: your ${fieldShortName} slot request for ${date} ${time} was declined. ${reason ?? 'No reason given.'}`
- Superseded: `PYL: your ${fieldShortName} ${date} ${time} request was declined — another team got the slot first.`
- Override: `PYL: your ${date} ${time} practice at ${fieldShortName} is bumped for a rec makeup. ${reason ? 'Reason: ' + reason : ''} Request another: fields.poweryourleague.com/coach`

### Unit 3 — Override UI in BlockDrawer

Modify `app/admin/_components/block-drawer.tsx`:

- For blocks where `source` is `travel_recurring` or `manual` AND `status='confirmed'` AND `start_at > now`:
  - Render an expandable "Override for rec makeup" section
  - Form: away team (text), home team (text), reason (textarea, optional)
  - Submit button: "Override & notify coach"
  - Confirmation via native `confirm()` is fine (avoids the cost of a modal library)
- For blocks where `status='overridden'`:
  - Render a banner: "Overridden for rec makeup"
  - If `overridden_by_block_id` exists, fetch and show the replacement block's teams + a "View" link that switches `?block=<id>` to the replacement
  - Note the admin who overrode (currently untracked; defer)

### Unit 4 — `overrideTravelBlock` server action

Add to `app/admin/_actions.ts`:

```typescript
export async function overrideTravelBlock(formData: FormData): Promise<void>;
```

Steps:
1. `requireAdmin()`
2. Read form: `block_id`, `away_team_raw`, `home_team_raw`, `reason`
3. Load block; verify source in `('travel_recurring','manual')` and status='confirmed'
4. Insert replacement `schedule_blocks` row:
   - `source='override'`, `status='confirmed'`
   - Same `org_id`, `field_id`, `start_at`, `end_at` as original
   - `home_team_raw`, `away_team_raw` from form
   - `notes = reason`
   - `team_id = null` (rec game has no travel team)
5. Update original block:
   - `status='overridden'`
   - `overridden_by_block_id = new block id`
   - `override_reason = reason`
6. Load all coaches where `team_id = original.team_id`
7. Load field name
8. Call `notifyTravelOverridden(...)` for the affected coaches
9. `revalidatePath('/admin')` and `revalidatePath('/coach')`

### Unit 5 — `/admin/notifications` page

New route: `app/admin/notifications/page.tsx`

- Server component; uses admin client
- Loads last 100 `notifications` rows, joined with coach names for display
- Table columns:
  - **Time** (ET, relative + full timestamp in tooltip)
  - **Channel** (📧 email / 📱 SMS icon + label)
  - **Coach** (name)
  - **Content** (subject for email, first 60 chars of body for SMS)
  - **Status** (pill: sent / failed / pending / skipped)
  - **Error** (small text, if any)
- Simple filter chips at top: `All` · `Email` · `SMS` · `Failed` (read from query param `?filter=`)
- Auto-refresh every 60s via `export const revalidate = 60` (so pending → sent transitions show up without manual reload)

### Unit 6 — Admin nav update

Add 5th link "Notifications" to `AdminNav`. No badge needed — notifications are passive viewing, not action items.

### Unit 7 — Schema migration

`supabase/migrations/0004_notifications_skipped.sql`:

```sql
alter table notifications drop constraint notifications_status_check;
alter table notifications add constraint notifications_status_check
  check (status in ('pending','sent','failed','delivered','skipped'));
```

Minor — adds 'skipped' to the allowed status values so we can record "no phone, SMS skipped" without an error.

---

## Data model

No new tables. All columns already exist from Session 1:
- `schedule_blocks.status='overridden'`, `schedule_blocks.overridden_by_block_id`, `schedule_blocks.override_reason`
- `schedule_blocks.source='override'`
- `notifications.channel='sms'`, `notifications.status='skipped'` (added by migration 0004)

---

## Server actions

New:
- `overrideTravelBlock(formData)` in `app/admin/_actions.ts`

No changes to existing actions.

---

## Error handling

- Override fails at step 4 (insert) → throw from action; user sees error via existing admin error boundary. The travel block stays unchanged.
- Override succeeds but SMS/email fails → notifications row records failure; the override itself is intact; admin sees the failure in the notifications log.
- Twilio rate limiting or transient error → one-shot failure, not retried automatically (notifications log is the source of truth; Session 6 could add retry).

---

## Testing

Unit tests (vitest) for pure logic:
- `formatOverrideSms(data)` — ensures the template fills correctly under 160 chars

No E2E tests — Twilio costs real money. Use `TWILIO_MODE=dev` for local verification.

Manual QA:
1. Local: set `TWILIO_MODE=dev`; trigger override; verify console log shows SMS content + notifications table logs it with status='sent' (id='dev-logged').
2. Prod: real SMS to your phone after override; check delivery time < 10 seconds.
3. Approve a slot request for a coach with a phone → both email and SMS arrive.
4. Override a block for a coach without a phone → email arrives, notifications log shows 'skipped' row for the SMS.
5. Check `/admin/notifications` shows last activity with correct status / channel.

---

## Exit criteria

- [ ] `TWILIO_*` env vars set in `.env.local` + Vercel prod
- [ ] Migration 0004 applied
- [ ] Override section appears on the drawer for travel/manual confirmed future blocks
- [ ] Override creates the rec block, marks the travel block overridden, fires email + SMS
- [ ] SMS on approve/deny/supersede fires alongside email
- [ ] `/admin/notifications` page shows last 100 with filters
- [ ] `TWILIO_MODE=dev` on localhost doesn't hit Twilio but still logs to notifications table
- [ ] End-to-end: override in prod → coach's phone gets SMS within 10 seconds

---

## Open questions (resolve during build, not blocking)

- Should `notifyRequestSubmitted` send SMS to admins, or stay email-only? Default: email only (admins can check the UI; SMS on admin-side is over-notification for MVP).
- What happens if a coach has multiple rows on the same team (co-coaches)? Default: notify all of them (iterate).
- Admin's phone number — do they want SMS on anything? Not in this session; add as follow-up if Meesh wants it.
