# Session 4 — Coach Portal + Slot Requests (Design)

**Date:** 2026-04-21
**Status:** Design approved; ready for implementation plan.
**Roadmap slot:** Session 4 per `SCOPE.md §9`.

---

## Goal

Let a coach log in, see their team's practices, request a weekend or Friday slot within a defined open window, and receive an email when admin approves or denies it. Flip the admin dashboard into a working approval hub.

## Non-goals

- SMS notifications — Session 5
- Rec-override-travel flow — Session 5
- Coach calendar / week grid view — list view is sufficient for MVP; grid can come later
- Self-serve auto-approval — admin approves every request in this session
- Bulk approve / deny
- Recurring-slot CRUD in the UI — admin edits `travel_recurring_slots` via SQL if needed

---

## Decisions made during brainstorming

- **30-minute granularity** for slot start + duration. Start is 30-min multiples within the open window; duration is {1h, 1.5h, 2h, 2.5h, 3h} capped by window end.
- **First-come-first-served on conflicts.** When admin approves one pending request, any other pending requests that overlap in time on the same field are auto-denied with note `"superseded"`.
- **Email notifications in Session 4** using Resend directly (not Supabase Auth SMTP). Logged to existing `notifications` table for audit.
- **Open windows replace pre-seeded open_slot blocks.** The `source='open_slot'` pre-seeding from Session 1 is deleted; the seed stops creating them.

---

## Units

### Unit 1 — Open windows schema + seed rewrite

**New migration:** `supabase/migrations/0002_open_windows.sql`

```sql
create table open_windows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  field_id uuid references fields(id) not null,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  notes text,
  created_at timestamptz default now()
);
create unique index on open_windows (org_id, field_id, day_of_week, start_time);

alter table open_windows enable row level security;

create policy "admin full access open_windows" on open_windows
  for all using (is_admin());
create policy "authed can read open_windows" on open_windows
  for select using (auth.uid() is not null);

-- One-time cleanup: remove stale pre-seeded open_slot blocks.
delete from schedule_blocks
  where source = 'open_slot'
    and start_at >= current_date;
```

**Update `supabase/seed.sql`:**
- Remove the open_slot `insert into schedule_blocks` block at the bottom
- Add `open_windows` inserts for 885 Back Field:
  - Fri (dow=5): 20:00–22:00
  - Sat (dow=6): 11:00–19:00
  - Sun (dow=0): 09:00–19:00
- Follow the existing idempotent pattern (`not exists (select 1 from open_windows ...)`)

### Unit 2 — Server-side request helpers

**New:** `lib/requests/windows.ts`

Pure helpers for the slot-request form and validator:

```typescript
export type OpenWindow = {
  id: string;
  field_id: string;
  day_of_week: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

export function windowsForDate(
  windows: OpenWindow[],
  fieldId: string,
  dateEt: Date
): OpenWindow[]; // filtered by field + day_of_week matching the ET date

export function fitsInWindow(
  window: OpenWindow,
  startAtUtc: Date,
  endAtUtc: Date
): boolean; // true if [start,end] ⊆ window's ET range on that date
```

**New:** `lib/requests/validate.ts` (server-only)

```typescript
export async function validateSlotRequest(
  admin: SupabaseClient,
  orgId: string,
  input: {
    field_id: string;
    start_at: Date;
    end_at: Date;
    requester_coach_id: string;
  }
): Promise<{ ok: true } | { ok: false; reason: string }>;
```

Checks:
1. `end_at > start_at` and duration ≤ 3h
2. Start and end land on 30-minute boundaries
3. The `(field_id, dow, start_time, end_time)` falls inside a defined open window
4. No overlap with an existing `status in ('confirmed','tentative')` `schedule_blocks` row on that field
5. Coach has no pending request for an overlapping window (prevent spammy dupes)

All checks return `{ ok: false, reason }` on first failure.

### Unit 3 — Coach portal (`/coach`)

Replace the placeholder. Server component with sections:

**Header:**
- "Welcome, <name> · <team name>"
- "Sign out"

**Section: Your upcoming blocks**
- Query: `schedule_blocks` where `team_id = coach.team_id` AND `start_at >= now()` AND `status != 'cancelled'`, next 4 weeks, order by start_at
- List each with date / time (ET) / field / source label ("Practice" for travel_recurring, "Practice" for manual)
- Each row has a "Cancel" button (server action) if the block is future

**Section: Request a slot** (collapsed by default; expands to form)

Form fields:
- Field — default 885 Back; dropdown only if >1 field has any open window
- Date — date picker, clamped to within 4 weeks ahead; only days that have an open window for the selected field
- Start time — `<select>` of 30-min increments between window start and (window end − min duration)
- Duration — `<select>` of 1h / 1.5h / 2h / 2.5h / 3h, values that fit the remaining window space enabled
- Note — optional textarea
- Submit → server action inserts `slot_requests`

Client component needed for the date-driven time-slot dropdown (hydrate + re-compute available times from an initial server-rendered JSON blob of windows).

**Section: Your pending requests**
- Query: `slot_requests` where `requester_coach_id = coach.id` AND `status='pending'`
- Each row shows requested time + field + submitted_at + a "Withdraw" button (sets status='cancelled')

**Section: Your recent decided requests** (optional, shows last 5 approved/denied for status visibility)

### Unit 4 — Admin approval queue

**Route:** `/admin/requests`

- Added to secondary admin nav: Dashboard · Coaches · Fields · **Requests**
- The "Requests" link shows a count badge (e.g., `Requests (3)`) when pending_count > 0 — the admin layout fetches the count once per request.

**Page layout:**
- Table of pending requests:
  - Submitted_at (relative: "2h ago")
  - Coach name + team
  - Field short name
  - Start–end (ET)
  - Duration
  - Coach's note
  - Actions: **Approve** (primary) / **Deny** (secondary) — each is a form with an optional `admin_note` input (revealed on deny)
- Below: a collapsed section "Recently decided (last 7 days)" for audit: approved + denied requests with their resolution

**Approve action:**
1. Load the request
2. Validate it one more time (another coach could have claimed the slot meanwhile)
3. Insert a new `schedule_blocks` row: `source='manual'`, `status='confirmed'`, `team_id`, `start_at`, `end_at`, `notes` = coach note
4. Update the request: `status='approved'`, `resolved_at=now`, `admin_note` if provided
5. Find overlapping pending requests on the same field, update them to `status='denied'`, `admin_note='superseded'`, `resolved_at=now`
6. Enqueue email notifications (Unit 5) for the approved coach + each superseded coach
7. Revalidate `/admin/requests`, `/admin`, `/coach`

**Deny action:**
1. Update request: `status='denied'`, `admin_note`, `resolved_at`
2. Enqueue email to coach
3. Revalidate

### Unit 5 — Email notifications via Resend

**New env var:** `RESEND_API_KEY` (set in `.env.local` + Vercel prod)

**New lib:** `lib/email/send.ts`

```typescript
type EmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};
export async function sendEmail(input: EmailInput): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
>;
```

Uses `fetch` against `https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}`. No npm dep needed — keeping the bundle small.

**New lib:** `lib/notifications/enqueue.ts` (server-only)

```typescript
export async function notifyRequestSubmitted(
  admin: SupabaseClient,
  request: SlotRequest
): Promise<void>;

export async function notifyRequestApproved(
  admin: SupabaseClient,
  request: SlotRequest,
  blockId: string
): Promise<void>;

export async function notifyRequestDenied(
  admin: SupabaseClient,
  request: SlotRequest,
  reason: string | null
): Promise<void>;
```

Each function:
1. Insert a row in `notifications` table (channel='email', status='pending', body, coach_id, request_id)
2. Call `sendEmail`
3. Update the notification row: status='sent' with external_id, OR status='failed' with error_message

Template shape (plain HTML):

- **Request submitted → admin(s):**
  Subject: `New slot request: <team> on <date>`
  Body: "A coach requested a slot: <coach name>, <team>, <field>, <start–end>. Note: <note>. Approve or deny at <admin URL>."

- **Request approved → coach:**
  Subject: `Your slot is confirmed`
  Body: "Your <field> slot on <date> from <start–end> is confirmed. Admin note: <admin_note if any>. See it at <coach URL>."

- **Request denied → coach:**
  Subject: `Your slot request was declined`
  Body: "Your <field> slot on <date> from <start–end> was declined. Reason: <reason or 'No reason given'>. Request another at <coach URL>."

- **Request superseded → coach:**
  Subject: `Your slot request was declined (slot filled)`
  Body: "Another team's request for <field> <start–end> was approved first. Your request is automatically declined. Try another window at <coach URL>."

### Unit 6 — Navigation + shared pieces

- `AdminNav` gets a 4th link: "Requests" — active-state detection + badge count
- Request count fetched once in `admin/layout.tsx` and passed to `<AdminNav pendingRequests={N} />` (so it's accurate without a client fetch)

---

## Data model summary

Tables touched:
- **New:** `open_windows` (Unit 1)
- **Existing:** `slot_requests`, `schedule_blocks`, `notifications`, `coaches`, `teams`

No changes to existing tables. All columns exist from Session 1.

---

## Server actions (new entries in `app/admin/_actions.ts` or a new file)

```typescript
// Admin actions
export async function approveSlotRequest(formData: FormData): Promise<void>;
export async function denySlotRequest(formData: FormData): Promise<void>;

// Coach actions (new file: app/coach/_actions.ts)
export async function submitSlotRequest(formData: FormData): Promise<void>;
export async function withdrawSlotRequest(formData: FormData): Promise<void>;
export async function cancelOwnBlock(formData: FormData): Promise<void>;
```

Each action uses `requireAdmin()` / a new `requireCoach()` helper that mirrors it for coach routes.

---

## Auth + authorization

- `/coach` already protected by middleware
- `coachOnly` wrapper for coach server actions: verifies authed user has a coach row (any role OK)
- Admin actions continue to use `requireAdmin`
- RLS policies updated so:
  - Coaches can `select` their own `slot_requests` (already in place)
  - Coaches can `insert slot_requests` where `requester_coach_id = own` (already in place)
  - Coaches can `update slot_requests` where own AND status='pending' (to withdraw)

---

## Error handling

- Form submit errors are thrown from server actions and bubble to the route's `error.tsx` boundary. Add a minimal `error.tsx` in `/coach` for human-readable failure display.
- Email send failures do NOT block the approval/denial action — the admin's approve click succeeds even if the notification fails, and the admin can see the failure in the notifications table later.
- Double-click prevention on approve/deny: disable the button after submit (client-side enhancement; server action is idempotent because we check request status at the start).

---

## Testing

Unit tests (vitest) for the pure helpers:

- `windowsForDate` — given a list of windows + a date, returns the correct subset
- `fitsInWindow` — boundary cases: exactly at window start/end, across DST
- `validateSlotRequest` — mock the Supabase client with fixtures (windows + existing blocks) and verify each failure reason

Manual QA (against `/coach` + `/admin/requests`):

1. Add a test coach via `/admin/coaches/new`, assign 9U B Jaguars — Mitko
2. Log in as that coach → `/coach` shows Mon 8–10pm travel_recurring block
3. Fill out Request a slot: Sat 2–4pm at 885 Back → submit → see it in Pending
4. Log back in as admin → `/admin/requests` shows the request with badge `(1)` → approve
5. Log back in as coach → see Sat 2–4pm in Upcoming blocks with source=manual
6. Email arrives to coach with the approval
7. Cancel a travel practice → that dated row shows cancelled in the grid
8. Withdraw a pending request → gone from list

---

## Env vars

- `RESEND_API_KEY` — new, set in `.env.local` + Vercel production

---

## Exit criteria

- [ ] New migration applied; `open_windows` has 3 rows for 885 Back
- [ ] `source='open_slot'` blocks are gone from `schedule_blocks`
- [ ] Coach portal shows the coach's upcoming blocks
- [ ] Coach can submit a slot request that validates against open windows
- [ ] Admin sees pending requests at `/admin/requests` with a count badge
- [ ] Admin approves → new confirmed block appears, overlapping requests auto-denied
- [ ] Admin denies → request is marked denied with note
- [ ] Coach gets an email via Resend on approve / deny / supersede
- [ ] Notifications table records every email attempt
- [ ] All TypeScript + tests pass; prod build clean

---

## Open questions (resolve during build, not blocking)

- Which timezone does the date picker use on the coach form? Answer: ET (displayed and computed consistently; UTC only in storage).
- What happens if a coach tries to request a slot during their already-confirmed recurring practice? Answer: `validateSlotRequest` catches the overlap with the travel_recurring block and returns an error.
- Should the admin approval page show the week grid for context alongside requests? Defer to a later session — MVP is the list.
