# Concession Stand Sign-Ups — PYL Field Manager Module

## Overview
Volunteer sign-up system for TJYBB concession stand shifts. Lives inside PYL Field Manager (`fields.poweryourleague.com`). Two event modes: auto-generated weeknight games (2-hr blocks from iCal, **front field only**) and manual tournament days (1-hr blocks, admin-defined window). Public roster, SMS confirmation, one-tap cancel, day-of reminder.

**Concessions only run when the front field is in use.** Back field games (typically Minors division) do not generate concession events. Filtering happens on the iCal `LOCATION` field, not by division — this handles edge cases where a Majors game gets moved to the back field (no concessions) or a Minors game gets moved to the front field (concessions needed).

## Stack
Next.js 15 App Router, Supabase, Vercel (existing). Twilio for SMS (existing). Vercel Cron for reminders + nightly slot generation.

---

## Database Schema (Supabase)

```sql
-- Event = a single day of concession coverage
create table concession_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  event_type text not null check (event_type in ('game', 'tournament')),
  location text not null default 'Andrew Reilly Memorial Park',
  source_game_ids text[],           -- iCal UIDs that generated this (game type only)
  source_location text,             -- raw LOCATION string from iCal, for debugging matcher
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique(event_date, event_type)
);

-- Slot = a single shift block on an event
create table concession_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references concession_events(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  capacity int not null default 2,
  created_at timestamptz default now()
);

create index on concession_slots(event_id);
create index on concession_slots(start_time);

-- Signup = one volunteer claiming one spot in one slot
create table concession_signups (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references concession_slots(id) on delete cascade,
  volunteer_name text not null,
  volunteer_phone text not null,    -- E.164 format
  cancel_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  confirmed_at timestamptz,
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz default now()
);

create index on concession_signups(slot_id) where cancelled_at is null;
create index on concession_signups(cancel_token);

-- Enforce capacity at the DB level
create or replace function check_slot_capacity()
returns trigger as $$
begin
  if (
    select count(*) from concession_signups
    where slot_id = new.slot_id and cancelled_at is null
  ) >= (
    select capacity from concession_slots where id = new.slot_id
  ) then
    raise exception 'Slot is full';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger enforce_slot_capacity
  before insert on concession_signups
  for each row execute function check_slot_capacity();
```

**RLS:** Public read on events/slots/signups (names visible). Insert via authenticated server route only. Admin role for delete/manual create.

---

## Routes

### Public
- `GET /concessions` — list of upcoming events, ordered by date. Show date, type badge (Game / Tournament), slot count, fill status.
- `GET /concessions/[eventId]` — slot grid for one event. Each slot shows time range + signed-up names + claim button if open.
- `GET /concessions/cancel/[token]` — confirms cancellation, removes signup, sends SMS confirmation.

### Admin (`/admin/concessions`)
- List all events with signup counts
- Manually create tournament event (date, start hour, end hour)
- Manually add/remove signups
- Export CSV for any event (printable for stand)
- Trigger reminder send manually

### API
- `POST /api/concessions/claim` — body: `{ slotId, name, phone }`. Validates phone, normalizes to E.164, inserts signup, sends confirmation SMS, returns success.
- `POST /api/concessions/cancel` — body: `{ token }`. Soft-cancel via `cancelled_at`, send goodbye SMS.
- `GET /api/cron/generate-concessions` — runs nightly, syncs next 14 days of game iCal events into concession_events + slots.
- `GET /api/cron/send-reminders` — runs at 7 AM daily, sends day-of "Thanks for volunteering!" SMS for any signups whose slot is today.

### Cron config (`vercel.json`)
```json
{
  "crons": [
    { "path": "/api/cron/generate-concessions", "schedule": "0 6 * * *" },
    { "path": "/api/cron/send-reminders", "schedule": "0 7 * * *" }
  ]
}
```

---

## Slot Generation Logic

### Game events (auto, from iCal — front field only)
1. Cron pulls **both** iCal feeds via existing Field Manager integration:
   - `SPORTS_CONNECT_ICAL_MAJORS` (Majors division)
   - `SPORTS_CONNECT_ICAL_MINORS` (Minors division)
2. Combine all VEVENTs from both feeds into a single list (game IDs are unique across feeds)
3. Filter to events where `LOCATION` matches the front field — see **Front Field Matching** below
4. Filter to next 14 days
5. Group filtered games by date
6. For each date, create one `concession_events` row (`event_type = 'game'`)
7. For each game on that date:
   - Slot start = game start time − 30 minutes
   - Slot end = slot start + 2 hours
8. Dedupe overlapping slots (if two games start within 30 min of each other, merge into one 2-hr slot)
9. Capacity = 2 per slot
10. Skip dates that already have a `concession_events` row
11. **If a previously-synced game gets moved off the front field**, mark the corresponding slot as cancelled and notify any signed-up volunteers via SMS

### Front Field Matching
Sports Connect `LOCATION` strings are inconsistent (e.g., "Andrew Reilly Field 1", "Reilly Front", "ARMP - Front"). Use a normalized matcher:

```ts
const FRONT_FIELD_PATTERNS = [
  /front/i,
  /field\s*1\b/i,
  /\bf1\b/i,
  // add more as you see them in the wild
];

function isFrontField(location: string | undefined): boolean {
  if (!location) return false;
  return FRONT_FIELD_PATTERNS.some(p => p.test(location));
}
```

Store the raw `LOCATION` string on `concession_events.source_location` for debugging. Add a quick admin view to surface "unmatched LOCATION strings seen in the last 30 days" so you can extend the regex list without redeploying logic each time a new variant shows up.

### Tournament events (manual)
1. Admin enters date + start hour + end hour
2. Generate one 1-hour slot per hour in window
3. Capacity = 2 per slot
4. Example: May 16, 9 AM – 6 PM = 9 slots

---

## Twilio SMS Templates

**Confirmation (immediate, on claim)**
```
TJYBB Concessions: You're signed up for {DAY} {DATE}, {START}–{END} at Andrew Reilly. Thanks for volunteering!
Need to cancel? {CANCEL_URL}
```

**Day-of reminder (7 AM)**
```
TJYBB Concessions reminder: Your shift today is {START}–{END} at Andrew Reilly. Thanks for stepping up! Questions: info@tjybb.org
```

**Cancellation confirmation**
```
TJYBB Concessions: Your shift on {DATE} {START}–{END} has been cancelled. Thanks for letting us know.
```

Use existing Twilio credentials. Format phones to E.164 on input (assume US, prepend +1).

---

## UI Notes

Use TJYBB branding: black + Steelers gold (#FFB612). Match existing Field Manager component library.

**`/concessions` page**
- Header: "TJYBB Concession Stand Volunteers"
- Subhead: short pitch ("Sign up for an hour or two — every shift helps the league.")
- List of upcoming event cards: date, type badge, "X of Y slots filled", click → detail page

**`/concessions/[eventId]` page**
- Date + location header
- Vertical list of time slots
- Each slot row:
  - Time range (e.g., "10:00 AM – 11:00 AM")
  - 2 spots side-by-side
  - Filled spot: show first name + last initial (e.g., "Mike S.")
  - Open spot: "Claim" button → opens modal with name + phone fields
- After claim: show confirmation, refresh slot
- "Cancel" link only appears via SMS, not on public page

**Claim modal**
- Name (required, 2+ chars)
- Phone (required, validated, normalized to E.164)
- Submit → POST to `/api/concessions/claim`
- Loading state, success state, error state (slot full, invalid phone, etc.)

---

## Validation

- Phone: strip non-digits, require 10 digits (US), prepend +1
- Name: trim, 2–60 chars, no SQL/HTML
- Slot must exist and not be full (DB trigger backstops this)
- One phone number can claim multiple slots, but not the same slot twice (add unique constraint on `(slot_id, volunteer_phone)` where `cancelled_at is null`)

---

## Build Order for Claude Code

1. Migration: tables + trigger + RLS
2. `/api/concessions/claim` + `/api/concessions/cancel` + Twilio helper
3. `/concessions` and `/concessions/[eventId]` pages
4. `/concessions/cancel/[token]` page
5. Cron: `generate-concessions` (use existing iCal helper)
6. Cron: `send-reminders`
7. `/admin/concessions` with manual tournament creator + CSV export
8. Seed May 16 manually via admin UI as the first real test
9. Verify Twilio sandbox → production send

---

## May 16 Manual Seed

Once the admin UI ships, create:
- Date: 2026-05-16
- Type: tournament
- Window: 9 AM – 6 PM
- Generates 9 slots × 2 capacity = 18 volunteer spots

Share `https://fields.poweryourleague.com/concessions/[eventId]` with the team.
