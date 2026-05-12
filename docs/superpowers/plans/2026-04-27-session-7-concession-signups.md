# Session 7 — Concession Stand Sign-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public concession-stand volunteer sign-up flow on `fields.poweryourleague.com/concessions` that auto-generates 2-hour shifts per front-field rec game (from BOTH Minors and Majors iCal feeds), supports manual tournament events with hourly slots, and notifies volunteers by **email** (not SMS — Twilio deferred). Public sign-up + cancel via tokenized email link.

**Architecture:** New `concession_events`, `concession_slots`, `concession_signups` tables with a capacity trigger. Public routes under `/concessions/*` (middleware exempts these from auth). Slots auto-materialize from the existing `schedule_blocks` data (rec games on the Front Field), eliminating the spec's regex `LOCATION` matcher. Two iCal env vars replace the single one. Resend handles all volunteer notifications.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS, `@supabase/ssr` + `@supabase/supabase-js`, Resend (existing setup), `date-fns` + `date-fns-tz`, `node-ical` (existing). No new dependencies.

---

## Preconditions

- [x] All 6 prior sessions shipped (Sessions 1–6 on `main`)
- [x] Spec: `concession-signups-spec.md` at repo root
- [x] Resend SMTP + API key configured (used by Sessions 4–5 email)
- [x] Existing `schedule_blocks` ingestor maps DESCRIPTION → `fields` row
- [x] `885 Front Field (Huber)` exists in `fields` table with the matching `sports_connect_description`
- [ ] **Meesh interactive step:** apply migration 0005 via Supabase SQL Editor
- [ ] **Meesh interactive step:** set `SPORTS_CONNECT_ICAL_MINORS` and `SPORTS_CONNECT_ICAL_MAJORS` in `.env.local` and Vercel

---

## Decisions locked in during brainstorming

- **Email, not SMS.** Volunteer contact is `email`, not `phone`. All Twilio code paths skipped here. Schema uses `volunteer_email`.
- **Dual feeds.** Two env vars: `SPORTS_CONNECT_ICAL_MINORS` (existing `id=46947147`) and `SPORTS_CONNECT_ICAL_MAJORS` (`id=47015738`). The legacy `SPORTS_CONNECT_ICAL_URL` becomes the fallback alias for `_MINORS` to avoid breaking other code paths.
- **Front-field detection by `field_id`, not regex.** Concession generation queries `schedule_blocks WHERE source='sports_connect' AND field_id = <front field id>` instead of pattern-matching the raw `LOCATION` string. Reuses our existing field mapping.
- **Public routes opt out of auth.** `middleware.ts` (still effectively `proxy.ts`) matcher already only protects `/admin/:path*` and `/coach/:path*`, so `/concessions/*` is naturally public. No middleware changes needed.
- **Slot generation runs hourly alongside the existing sync.** Add a step to the GitHub Actions workflow rather than introducing a separate Vercel Cron (which we deferred in Session 1).
- **Reminders run daily at 12:00 UTC (~8 AM ET).** Added as a third GitHub Actions step.

---

## File structure at end of session

```
app/
  concessions/
    page.tsx                                (new — public event list)
    [eventId]/page.tsx                      (new — slot grid)
    cancel/[token]/page.tsx                 (new — cancel landing)
    _components/
      event-card.tsx                        (new)
      slot-row.tsx                          (new — slot + claim modal)
      claim-form.tsx                        (new — client)
  admin/
    concessions/
      page.tsx                              (new — admin event list + manual create)
      [eventId]/page.tsx                    (new — admin slot detail + CSV link)
      _actions.ts                           (new — createTournament, addSignup, removeSignup)
      _components/
        new-tournament-form.tsx             (new — client)
    _components/
      admin-nav.tsx                         (modify — add Concessions link)
  api/
    concessions/
      claim/route.ts                        (new — POST claim)
      cancel/route.ts                       (new — POST cancel)
      export/[eventId]/route.ts             (new — GET CSV)
    cron/
      generate-concessions/route.ts         (new — nightly sync from schedule_blocks)
      send-reminders/route.ts               (new — day-of email reminders)
lib/
  concessions/
    generate.ts                             (new — pure fn: from blocks → events/slots)
    generate.test.ts                        (new)
    csv.ts                                  (new — pure fn: signups → CSV)
    csv.test.ts                             (new)
  email/
    concession-templates.ts                 (new — confirm / cancel / reminder HTML)
  ical/
    parser.ts                               (modify — export fetchAndParseMany)
supabase/
  migrations/
    0005_concessions.sql                    (new)
.github/workflows/
  hourly-sync.yml                           (modify — add 2 concession steps)
.env.example                                (modify — document SPORTS_CONNECT_ICAL_MAJORS/MINORS)
```

---

## Phase 1 — Migration

### Task 1.1: Write the migration file

**Files:**
- Create: `supabase/migrations/0005_concessions.sql`

- [ ] **Step 1:** Write:

```sql
-- Concession events — a single day of coverage
create table concession_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  event_date date not null,
  event_type text not null check (event_type in ('game', 'tournament')),
  location text not null default 'Andrew Reilly Memorial Park',
  source_game_ids text[],
  source_location text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (org_id, event_date, event_type)
);
create index on concession_events (event_date);

-- Concession slots — a single shift block on an event
create table concession_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references concession_events(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  capacity int not null default 2,
  created_at timestamptz default now()
);
create index on concession_slots (event_id);
create index on concession_slots (start_at);

-- Concession signups — one volunteer claiming one spot
create table concession_signups (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references concession_slots(id) on delete cascade,
  volunteer_name text not null,
  volunteer_email text not null,
  cancel_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  confirmed_at timestamptz,
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz default now()
);
create index on concession_signups (slot_id) where cancelled_at is null;
create index on concession_signups (cancel_token);
create unique index concession_signups_one_email_per_slot
  on concession_signups (slot_id, lower(volunteer_email))
  where cancelled_at is null;

-- Capacity trigger
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

-- RLS
alter table concession_events enable row level security;
alter table concession_slots enable row level security;
alter table concession_signups enable row level security;

-- Public reads on events and slots so the /concessions page works without auth.
create policy "public read events" on concession_events for select using (true);
create policy "public read slots"  on concession_slots  for select using (true);

-- Signups: public can read non-cancelled rows (so volunteer names show on the page)
-- but only the server (service_role) can insert/update — claim/cancel API routes
-- use the admin client, never the user's RLS context.
create policy "public read active signups" on concession_signups
  for select using (cancelled_at is null);
create policy "admin full access events"  on concession_events for all using (is_admin());
create policy "admin full access slots"   on concession_slots  for all using (is_admin());
create policy "admin full access signups" on concession_signups for all using (is_admin());
```

### Task 1.2: Apply via Supabase Dashboard

- [ ] **Step 1:** Meesh pastes the SQL into the Supabase SQL Editor and runs it.
- [ ] **Step 2:** Verify:

```sql
select count(*) from concession_events; -- expect 0
select count(*) from concession_slots;  -- expect 0
select count(*) from concession_signups;-- expect 0
```

### Task 1.3: Commit migration

```bash
git add supabase/migrations/0005_concessions.sql
git commit -m "feat(db): concession events/slots/signups with capacity trigger and RLS"
git push
```

---

## Phase 2 — Env vars + multi-feed iCal parser

### Task 2.1: Document new env vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1:** Read the existing `.env.example`. Find the `SPORTS_CONNECT_ICAL_URL=...` line and replace with:

```
# --- Sports Connect iCal feeds ---------------------------------------------
# Two feeds: Minors (existing) and Majors (added Session 7).
# SPORTS_CONNECT_ICAL_URL still works as a fallback alias for _MINORS.
SPORTS_CONNECT_ICAL_MINORS=https://calendar.bluesombrero.com/api/v1/Calendar?instancekey=leagues&portalId=10693&id=46947147&key=1NIZ8FA4
SPORTS_CONNECT_ICAL_MAJORS=https://calendar.bluesombrero.com/api/v1/Calendar?instancekey=leagues&portalId=10693&id=47015738&key=ONHV0AOQ
```

### Task 2.2: Multi-feed parser helper

**Files:**
- Modify: `lib/ical/parser.ts`

- [ ] **Step 1:** Append at end of file:

```typescript
/**
 * Fetch one or more iCal URLs and return their combined normalized events.
 * Deduplicates on UID (same event in two feeds collapses to one).
 */
export async function fetchAndParseManyIcal(urls: string[]): Promise<NormalizedEvent[]> {
  const results = await Promise.all(urls.map((u) => fetchAndParseIcal(u)));
  const byUid = new Map<string, NormalizedEvent>();
  for (const events of results) {
    for (const ev of events) byUid.set(ev.uid, ev);
  }
  return [...byUid.values()];
}
```

### Task 2.3: Update sync route to use both feeds

**Files:**
- Modify: `app/api/sync/sports-connect/route.ts`

- [ ] **Step 1:** Locate the line that uses `SPORTS_CONNECT_ICAL_URL`. Replace the URL resolution + `fetchAndParseIcal` call with:

```typescript
  const minors = process.env.SPORTS_CONNECT_ICAL_MINORS ?? process.env.SPORTS_CONNECT_ICAL_URL;
  const majors = process.env.SPORTS_CONNECT_ICAL_MAJORS;
  const urls = [minors, majors].filter((u): u is string => Boolean(u));
  if (urls.length === 0) {
    return NextResponse.json({ error: 'No Sports Connect iCal URL configured' }, { status: 500 });
  }
```

Then change the events fetch from `fetchAndParseIcal(icalUrl)` to `fetchAndParseManyIcal(urls)`. Import the new function at top.

### Task 2.4: Push the new env vars to Vercel

- [ ] **Step 1:** Meesh adds `SPORTS_CONNECT_ICAL_MINORS` and `SPORTS_CONNECT_ICAL_MAJORS` to `.env.local` (Meesh pastes values).
- [ ] **Step 2:** I run:

```bash
node --env-file=.env.local -e "process.stdout.write(process.env.SPORTS_CONNECT_ICAL_MINORS)" | npx vercel@latest env add SPORTS_CONNECT_ICAL_MINORS production
node --env-file=.env.local -e "process.stdout.write(process.env.SPORTS_CONNECT_ICAL_MAJORS)" | npx vercel@latest env add SPORTS_CONNECT_ICAL_MAJORS production
```

### Task 2.5: Commit + deploy

```bash
git add .env.example lib/ical/parser.ts app/api/sync/sports-connect/route.ts
git commit -m "feat(sync): support dual iCal feeds via SPORTS_CONNECT_ICAL_MINORS + _MAJORS"
git push
npx vercel@latest --prod --yes
```

---

## Phase 3 — Concession slot generation (TDD)

### Task 3.1: Generation algorithm tests

**Files:**
- Create: `lib/concessions/generate.test.ts`

- [ ] **Step 1:** Write tests covering core behavior:

```typescript
import { describe, it, expect } from 'vitest';
import { generateConcessionSlots, type GameBlock } from './generate';

const FRONT = 'field-front';
const ORG = 'org-1';

function block(start: string, end: string, source_uid: string): GameBlock {
  return { id: 'b-' + source_uid, field_id: FRONT, source_uid, start_at: start, end_at: end };
}

describe('generateConcessionSlots', () => {
  it('produces one slot per game starting 30 minutes before the game', () => {
    const games = [block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1')];
    const result = generateConcessionSlots(games, ORG);
    expect(result).toHaveLength(1);
    const ev = result[0];
    expect(ev.event_type).toBe('game');
    expect(ev.slots).toHaveLength(1);
    expect(ev.slots[0].start_at.toISOString()).toBe('2026-05-05T21:30:00.000Z');
    expect(ev.slots[0].end_at.toISOString()).toBe('2026-05-05T23:30:00.000Z');
    expect(ev.slots[0].capacity).toBe(2);
    expect(ev.source_game_ids).toEqual(['g1']);
  });

  it('groups multiple games on the same date into one event', () => {
    const games = [
      block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1'),
      block('2026-05-06T00:00:00Z', '2026-05-06T02:00:00Z', 'g2'),
    ];
    const result = generateConcessionSlots(games, ORG);
    expect(result).toHaveLength(1);
    expect(result[0].slots).toHaveLength(2);
    expect(result[0].source_game_ids.sort()).toEqual(['g1', 'g2']);
  });

  it('merges overlapping slots (games starting within 30 min of each other)', () => {
    const games = [
      block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1'),
      block('2026-05-05T22:15:00Z', '2026-05-06T00:15:00Z', 'g2'),
    ];
    const result = generateConcessionSlots(games, ORG);
    expect(result[0].slots).toHaveLength(1);
  });

  it('separates events by date in America/New_York', () => {
    const games = [
      block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1'),
      block('2026-05-12T22:00:00Z', '2026-05-13T00:00:00Z', 'g2'),
    ];
    const result = generateConcessionSlots(games, ORG);
    expect(result).toHaveLength(2);
    expect(result[0].event_date).toBe('2026-05-05');
    expect(result[1].event_date).toBe('2026-05-12');
  });
});
```

- [ ] **Step 2:** Run — expect "Cannot find module './generate'".

### Task 3.2: Implement `generateConcessionSlots`

**Files:**
- Create: `lib/concessions/generate.ts`

- [ ] **Step 1:** Write:

```typescript
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

export type GameBlock = {
  id: string;
  field_id: string;
  source_uid: string;
  start_at: string;
  end_at: string;
};

export type GeneratedSlot = {
  start_at: Date;
  end_at: Date;
  capacity: number;
};

export type GeneratedEvent = {
  org_id: string;
  event_date: string; // YYYY-MM-DD in ET
  event_type: 'game';
  source_game_ids: string[];
  slots: GeneratedSlot[];
};

const HALF_HOUR_MS = 30 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function generateConcessionSlots(
  games: GameBlock[],
  orgId: string
): GeneratedEvent[] {
  // Group by event date (in ET)
  const byDate = new Map<string, GameBlock[]>();
  for (const g of games) {
    const date = formatInTimeZone(new Date(g.start_at), TZ, 'yyyy-MM-dd');
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(g);
  }

  const events: GeneratedEvent[] = [];
  for (const [date, dateGames] of [...byDate.entries()].sort()) {
    // Build provisional slots
    const provisional: { slot: GeneratedSlot; uids: string[] }[] = dateGames
      .map((g) => {
        const gameStart = new Date(g.start_at).getTime();
        return {
          slot: {
            start_at: new Date(gameStart - HALF_HOUR_MS),
            end_at: new Date(gameStart - HALF_HOUR_MS + TWO_HOURS_MS),
            capacity: 2,
          },
          uids: [g.source_uid],
        };
      })
      .sort((a, b) => a.slot.start_at.getTime() - b.slot.start_at.getTime());

    // Merge overlaps
    const merged: { slot: GeneratedSlot; uids: string[] }[] = [];
    for (const p of provisional) {
      const last = merged[merged.length - 1];
      if (last && p.slot.start_at.getTime() < last.slot.end_at.getTime()) {
        last.slot.end_at = new Date(
          Math.max(last.slot.end_at.getTime(), p.slot.end_at.getTime())
        );
        last.uids.push(...p.uids);
      } else {
        merged.push(p);
      }
    }

    events.push({
      org_id: orgId,
      event_date: date,
      event_type: 'game',
      source_game_ids: merged.flatMap((m) => m.uids),
      slots: merged.map((m) => m.slot),
    });
  }

  return events;
}
```

- [ ] **Step 2:** Run — expect all tests pass.
- [ ] **Step 3:** Commit:

```bash
git add lib/concessions/generate.ts lib/concessions/generate.test.ts
git commit -m "feat(concessions): generate slots from front-field game blocks (tested)"
git push
```

---

## Phase 4 — Concession sync route

### Task 4.1: Cron route for generating concession events

**Files:**
- Create: `app/api/cron/generate-concessions/route.ts`

- [ ] **Step 1:** Write:

```typescript
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateConcessionSlots } from '@/lib/concessions/generate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: org } = await admin
    .from('organizations').select('id').eq('slug', 'tjybb').single();
  if (!org) return NextResponse.json({ error: 'org missing' }, { status: 500 });

  const { data: frontField } = await admin
    .from('fields').select('id').eq('name', '885 Front Field').maybeSingle();
  if (!frontField) {
    return NextResponse.json({ error: 'Front field not found' }, { status: 500 });
  }

  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 14);

  const { data: games } = await admin
    .from('schedule_blocks')
    .select('id, field_id, source_uid, start_at, end_at, status')
    .eq('source', 'sports_connect')
    .eq('field_id', frontField.id)
    .neq('status', 'cancelled')
    .gte('start_at', new Date().toISOString())
    .lt('start_at', horizon.toISOString());

  const generated = generateConcessionSlots(
    (games ?? []).map((g) => ({
      id: g.id,
      field_id: g.field_id,
      source_uid: g.source_uid ?? g.id,
      start_at: g.start_at,
      end_at: g.end_at,
    })),
    org.id
  );

  let eventsInserted = 0;
  let slotsInserted = 0;

  for (const ev of generated) {
    const { data: existing } = await admin
      .from('concession_events')
      .select('id, source_game_ids')
      .eq('org_id', ev.org_id)
      .eq('event_date', ev.event_date)
      .eq('event_type', ev.event_type)
      .maybeSingle();

    if (existing) {
      // Already created. Update source_game_ids if changed.
      const newIds = ev.source_game_ids.sort();
      const oldIds = (existing.source_game_ids ?? []).slice().sort();
      if (JSON.stringify(newIds) !== JSON.stringify(oldIds)) {
        await admin
          .from('concession_events')
          .update({ source_game_ids: ev.source_game_ids })
          .eq('id', existing.id);
      }
      continue;
    }

    const { data: row } = await admin
      .from('concession_events')
      .insert({
        org_id: ev.org_id,
        event_date: ev.event_date,
        event_type: ev.event_type,
        source_game_ids: ev.source_game_ids,
      })
      .select('id')
      .single();
    if (!row) continue;
    eventsInserted += 1;

    for (const s of ev.slots) {
      const { error } = await admin.from('concession_slots').insert({
        event_id: row.id,
        start_at: s.start_at.toISOString(),
        end_at: s.end_at.toISOString(),
        capacity: s.capacity,
      });
      if (!error) slotsInserted += 1;
    }
  }

  return NextResponse.json({ ok: true, events_inserted: eventsInserted, slots_inserted: slotsInserted });
}

export async function GET(req: Request) {
  return POST(req);
}
```

### Task 4.2: Hook into hourly workflow

**Files:**
- Modify: `.github/workflows/hourly-sync.yml`

- [ ] **Step 1:** Add a third step after the existing two:

```yaml
      - name: Generate concession events
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            https://fields.poweryourleague.com/api/cron/generate-concessions
```

### Task 4.3: Commit

```bash
git add app/api/cron/generate-concessions/ .github/workflows/hourly-sync.yml
git commit -m "feat(concessions): hourly cron syncs front-field games into concession events"
git push
```

---

## Phase 5 — Email templates

### Task 5.1: Concession email templates

**Files:**
- Create: `lib/email/concession-templates.ts`

- [ ] **Step 1:** Write:

```typescript
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fields.poweryourleague.com';

function fmtWhen(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${formatInTimeZone(s, TZ, 'EEEE, MMM d')} · ${formatInTimeZone(s, TZ, 'h:mm a')} – ${formatInTimeZone(e, TZ, 'h:mm a')}`;
}

export function confirmationEmail(params: {
  name: string;
  start_at: string;
  end_at: string;
  location: string;
  cancelToken: string;
}) {
  const when = fmtWhen(params.start_at, params.end_at);
  return {
    subject: `TJYBB Concessions: shift confirmed — ${formatInTimeZone(new Date(params.start_at), TZ, 'EEE MMM d')}`,
    html: `
      <p>Hi ${params.name},</p>
      <p>You&apos;re signed up to volunteer at the TJYBB concession stand.</p>
      <p><strong>${when}</strong><br>${params.location}</p>
      <p>Thanks for stepping up — every shift helps the league.</p>
      <p>Need to cancel? <a href="${SITE}/concessions/cancel/${params.cancelToken}">Click here</a></p>
    `,
  };
}

export function reminderEmail(params: {
  name: string;
  start_at: string;
  end_at: string;
  location: string;
  cancelToken: string;
}) {
  const when = `${formatInTimeZone(new Date(params.start_at), TZ, 'h:mm a')} – ${formatInTimeZone(new Date(params.end_at), TZ, 'h:mm a')}`;
  return {
    subject: `TJYBB Concessions reminder — your shift is today`,
    html: `
      <p>Hi ${params.name},</p>
      <p>Quick reminder: your concession-stand shift is <strong>today at ${when}</strong> at ${params.location}.</p>
      <p>Thanks for volunteering!</p>
      <p>Questions? Reply to this email.</p>
      <p>Need to cancel? <a href="${SITE}/concessions/cancel/${params.cancelToken}">Click here</a></p>
    `,
  };
}

export function cancellationEmail(params: {
  name: string;
  start_at: string;
  end_at: string;
  location: string;
}) {
  const when = fmtWhen(params.start_at, params.end_at);
  return {
    subject: `TJYBB Concessions: shift cancelled`,
    html: `
      <p>Hi ${params.name},</p>
      <p>Your concession-stand shift on <strong>${when}</strong> at ${params.location} has been cancelled.</p>
      <p>Thanks for letting us know. You can sign up for another shift at any time: <a href="${SITE}/concessions">${SITE}/concessions</a></p>
    `,
  };
}
```

### Task 5.2: Commit

```bash
git add lib/email/concession-templates.ts
git commit -m "feat(email): concession confirmation/reminder/cancellation templates"
git push
```

---

## Phase 6 — Public API routes

### Task 6.1: Claim endpoint

**Files:**
- Create: `app/api/concessions/claim/route.ts`

- [ ] **Step 1:** Write:

```typescript
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { confirmationEmail } from '@/lib/email/concession-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 200) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return null;
  return trimmed;
}

export async function POST(req: Request) {
  let body: { slotId?: string; name?: string; email?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }); }

  const slotId = typeof body.slotId === 'string' ? body.slotId : null;
  const name = normalizeName(body.name);
  const email = normalizeEmail(body.email);

  if (!slotId) return NextResponse.json({ ok: false, error: 'Missing slot' }, { status: 400 });
  if (!name)   return NextResponse.json({ ok: false, error: 'Name must be 2–60 characters' }, { status: 400 });
  if (!email)  return NextResponse.json({ ok: false, error: 'Please use a valid email' }, { status: 400 });

  const admin = createAdminClient();

  const { data: slot } = await admin
    .from('concession_slots')
    .select('id, start_at, end_at, event_id')
    .eq('id', slotId)
    .maybeSingle();
  if (!slot) return NextResponse.json({ ok: false, error: 'Slot not found' }, { status: 404 });

  const { data: event } = await admin
    .from('concession_events')
    .select('location')
    .eq('id', slot.event_id)
    .maybeSingle();

  const { data: row, error } = await admin
    .from('concession_signups')
    .insert({
      slot_id: slotId,
      volunteer_name: name,
      volunteer_email: email,
      confirmed_at: new Date().toISOString(),
    })
    .select('cancel_token')
    .single();
  if (error) {
    if (error.message?.includes('Slot is full')) {
      return NextResponse.json({ ok: false, error: 'That slot just filled up. Pick another.' }, { status: 409 });
    }
    if (error.code === '23505') {
      return NextResponse.json({ ok: false, error: 'You already signed up for this slot.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: `Couldn't save: ${error.message}` }, { status: 500 });
  }

  const tmpl = confirmationEmail({
    name,
    start_at: slot.start_at,
    end_at: slot.end_at,
    location: event?.location ?? 'Andrew Reilly Memorial Park',
    cancelToken: row.cancel_token,
  });
  await sendEmail({ to: email, subject: tmpl.subject, html: tmpl.html });

  return NextResponse.json({ ok: true });
}
```

### Task 6.2: Cancel endpoint

**Files:**
- Create: `app/api/concessions/cancel/route.ts`

- [ ] **Step 1:** Write:

```typescript
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { cancellationEmail } from '@/lib/email/concession-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? (await req.json().catch(() => ({}))).token;
  if (typeof token !== 'string' || token.length < 8) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: signup } = await admin
    .from('concession_signups')
    .select('id, volunteer_name, volunteer_email, cancelled_at, slot_id')
    .eq('cancel_token', token)
    .maybeSingle();
  if (!signup) return NextResponse.json({ ok: false, error: 'Signup not found' }, { status: 404 });
  if (signup.cancelled_at) return NextResponse.json({ ok: true, alreadyCancelled: true });

  const { data: slot } = await admin
    .from('concession_slots')
    .select('start_at, end_at, event_id')
    .eq('id', signup.slot_id)
    .maybeSingle();
  const { data: event } = slot
    ? await admin.from('concession_events').select('location').eq('id', slot.event_id).maybeSingle()
    : { data: null };

  await admin
    .from('concession_signups')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', signup.id);

  if (slot) {
    const tmpl = cancellationEmail({
      name: signup.volunteer_name,
      start_at: slot.start_at,
      end_at: slot.end_at,
      location: event?.location ?? 'Andrew Reilly Memorial Park',
    });
    await sendEmail({ to: signup.volunteer_email, subject: tmpl.subject, html: tmpl.html });
  }

  return NextResponse.json({ ok: true });
}
```

### Task 6.3: Commit

```bash
git add app/api/concessions/
git commit -m "feat(concessions): claim + cancel API routes with confirmation emails"
git push
```

---

## Phase 7 — Reminder cron

### Task 7.1: Reminders route

**Files:**
- Create: `app/api/cron/send-reminders/route.ts`

- [ ] **Step 1:** Write:

```typescript
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { reminderEmail } from '@/lib/email/concession-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const now = new Date();
  const startOfDayUtc = new Date(now);
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const endOfDayUtc = new Date(startOfDayUtc);
  endOfDayUtc.setUTCDate(endOfDayUtc.getUTCDate() + 1);

  const { data: slots } = await admin
    .from('concession_slots')
    .select('id, start_at, end_at, event_id')
    .gte('start_at', startOfDayUtc.toISOString())
    .lt('start_at', endOfDayUtc.toISOString());

  if (!slots || slots.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, slots: 0 });
  }

  const slotIds = slots.map((s) => s.id);
  const { data: signups } = await admin
    .from('concession_signups')
    .select('id, slot_id, volunteer_name, volunteer_email, cancel_token, reminder_sent_at')
    .in('slot_id', slotIds)
    .is('cancelled_at', null);

  const eventIds = [...new Set(slots.map((s) => s.event_id))];
  const { data: events } = await admin
    .from('concession_events').select('id, location').in('id', eventIds);
  const locById = new Map((events ?? []).map((e) => [e.id, e.location]));
  const slotById = new Map(slots.map((s) => [s.id, s]));

  let sent = 0;
  for (const su of signups ?? []) {
    if (su.reminder_sent_at) continue;
    const slot = slotById.get(su.slot_id);
    if (!slot) continue;

    const tmpl = reminderEmail({
      name: su.volunteer_name,
      start_at: slot.start_at,
      end_at: slot.end_at,
      location: locById.get(slot.event_id) ?? 'Andrew Reilly Memorial Park',
      cancelToken: su.cancel_token,
    });
    const result = await sendEmail({ to: su.volunteer_email, subject: tmpl.subject, html: tmpl.html });
    if (result.ok) {
      await admin
        .from('concession_signups')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', su.id);
      sent += 1;
    }
  }

  return NextResponse.json({ ok: true, sent, slots: slots.length });
}

export async function GET(req: Request) {
  return POST(req);
}
```

### Task 7.2: Hook into daily cron via workflow

**Files:**
- Modify: `.github/workflows/hourly-sync.yml` (extend with daily reminder)

Add a separate workflow (cleaner than mixing daily + hourly), OR extend the existing one with a conditional.

- [ ] **Step 1:** Create `.github/workflows/daily-reminders.yml`:

```yaml
name: Daily concession reminders

on:
  schedule:
    - cron: "0 12 * * *"   # 12:00 UTC = 8 AM ET (EDT) / 7 AM EST
  workflow_dispatch:

jobs:
  remind:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Send day-of reminders
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            https://fields.poweryourleague.com/api/cron/send-reminders
```

### Task 7.3: Commit

```bash
git add app/api/cron/send-reminders/ .github/workflows/daily-reminders.yml
git commit -m "feat(concessions): daily reminder cron + send-reminders route"
git push
```

---

## Phase 8 — Public pages

### Task 8.1: Concessions list page

**Files:**
- Create: `app/concessions/page.tsx`
- Create: `app/concessions/_components/event-card.tsx`

- [ ] **Step 1:** Write `app/concessions/_components/event-card.tsx`:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

type Event = {
  id: string;
  event_date: string;
  event_type: 'game' | 'tournament';
  location: string;
  filled: number;
  capacity: number;
};

export function EventCard({ event }: { event: Event }) {
  const dateEt = new Date(`${event.event_date}T12:00:00Z`);
  const open = event.capacity - event.filled;
  return (
    <Link
      href={`/concessions/${event.id}`}
      className="block rounded-lg border border-tj-black/10 bg-white p-4 shadow-sm hover:border-tj-gold"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-tj-gold">
            {event.event_type === 'tournament' ? 'Tournament' : 'Game day'}
          </div>
          <h3 className="text-base font-semibold">
            {formatInTimeZone(dateEt, TZ, 'EEEE, MMMM d, yyyy')}
          </h3>
          <p className="text-xs opacity-70">{event.location}</p>
        </div>
        <div className="text-right text-sm">
          {open > 0 ? (
            <span className="font-medium text-tj-gold">{open} open</span>
          ) : (
            <span className="opacity-60">Full</span>
          )}
          <div className="text-xs opacity-60">{event.filled}/{event.capacity} filled</div>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2:** Write `app/concessions/page.tsx`:

```typescript
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { EventCard } from './_components/event-card';

export const revalidate = 60;

export default async function ConcessionsPage() {
  const admin = createAdminClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const { data: events } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location')
    .gte('event_date', today.toISOString().slice(0, 10))
    .order('event_date');

  // Bulk-load slots + signup counts
  const eventIds = (events ?? []).map((e) => e.id);
  const { data: slots } = eventIds.length
    ? await admin
        .from('concession_slots')
        .select('id, event_id, capacity')
        .in('event_id', eventIds)
    : { data: [] };
  const { data: signups } = eventIds.length
    ? await admin
        .from('concession_signups')
        .select('slot_id')
        .is('cancelled_at', null)
        .in('slot_id', (slots ?? []).map((s) => s.id))
    : { data: [] };

  const slotsByEvent = new Map<string, { capacity: number; ids: string[] }>();
  for (const s of slots ?? []) {
    const entry = slotsByEvent.get(s.event_id) ?? { capacity: 0, ids: [] };
    entry.capacity += s.capacity;
    entry.ids.push(s.id);
    slotsByEvent.set(s.event_id, entry);
  }
  const filledBySlot = new Map<string, number>();
  for (const su of signups ?? []) {
    filledBySlot.set(su.slot_id, (filledBySlot.get(su.slot_id) ?? 0) + 1);
  }

  const enriched = (events ?? []).map((e) => {
    const info = slotsByEvent.get(e.id);
    const filled = (info?.ids ?? []).reduce((acc, id) => acc + (filledBySlot.get(id) ?? 0), 0);
    return { ...e, capacity: info?.capacity ?? 0, filled };
  });

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <div className="text-xs uppercase tracking-wide text-tj-gold">TJYBB</div>
        <h1 className="text-lg font-semibold">Concession Stand Volunteers</h1>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <p className="text-sm opacity-80">
          Sign up for an hour or two — every shift helps the league.
        </p>
        {enriched.length === 0 ? (
          <p className="rounded border border-tj-black/10 bg-white p-6 text-sm text-tj-black/60">
            No upcoming events yet. Check back soon.
          </p>
        ) : (
          enriched.map((e) => <EventCard key={e.id} event={e} />)
        )}
        <p className="mt-4 text-xs opacity-60">
          <Link href="/login" className="underline hover:no-underline">Admin/coach sign-in</Link>
        </p>
      </main>
    </div>
  );
}
```

### Task 8.2: Slot detail page + claim form

**Files:**
- Create: `app/concessions/[eventId]/page.tsx`
- Create: `app/concessions/_components/claim-form.tsx`

- [ ] **Step 1:** Write `app/concessions/_components/claim-form.tsx`:

```typescript
'use client';

import { useState } from 'react';

export function ClaimForm({ slotId, onClose, onClaimed }: { slotId: string; onClose: () => void; onClaimed: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    const res = await fetch('/api/concessions/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId, name, email }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setStatus('error');
      setError(body.error ?? 'Something went wrong');
      return;
    }
    onClaimed();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Claim this shift</h2>
        <p className="mt-1 text-xs opacity-70">We&apos;ll email a confirmation and a cancel link.</p>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">Name</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-tj-black/20 px-3 py-2"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-tj-black/20 px-3 py-2"
          />
        </label>

        {error && <p className="mt-3 text-xs text-override-red">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={status === 'sending'}
            className="flex-1 rounded bg-tj-black px-3 py-2 text-sm text-tj-cream hover:bg-tj-black/80 disabled:opacity-50"
          >
            {status === 'sending' ? 'Submitting…' : 'Confirm sign-up'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-tj-black/20 px-3 py-2 text-sm hover:bg-tj-cream"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2:** Write `app/concessions/[eventId]/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { SlotRow } from '../_components/slot-row';

export const revalidate = 30;
const TZ = 'America/New_York';

export default async function ConcessionEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) notFound();

  const { data: slots } = await admin
    .from('concession_slots')
    .select('id, start_at, end_at, capacity')
    .eq('event_id', event.id)
    .order('start_at');

  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: signups } = slotIds.length
    ? await admin
        .from('concession_signups')
        .select('id, slot_id, volunteer_name')
        .is('cancelled_at', null)
        .in('slot_id', slotIds)
    : { data: [] };

  const signupsBySlot = new Map<string, { id: string; name: string }[]>();
  for (const su of signups ?? []) {
    const list = signupsBySlot.get(su.slot_id) ?? [];
    list.push({ id: su.id, name: su.volunteer_name });
    signupsBySlot.set(su.slot_id, list);
  }

  const dateEt = new Date(`${event.event_date}T12:00:00Z`);

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <Link href="/concessions" className="text-xs text-tj-gold-soft hover:text-tj-gold">← All events</Link>
        <h1 className="mt-1 text-lg font-semibold">
          {formatInTimeZone(dateEt, TZ, 'EEEE, MMMM d, yyyy')}
        </h1>
        <p className="text-xs opacity-70">{event.location}</p>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
        {(slots ?? []).length === 0 ? (
          <p className="rounded border border-tj-black/10 bg-white p-6 text-sm">No shifts yet.</p>
        ) : (
          (slots ?? []).map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              signups={signupsBySlot.get(slot.id) ?? []}
            />
          ))
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 3:** Write `app/concessions/_components/slot-row.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { ClaimForm } from './claim-form';

const TZ = 'America/New_York';

type Slot = { id: string; start_at: string; end_at: string; capacity: number };
type Signup = { id: string; name: string };

function shortenName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function SlotRow({ slot, signups }: { slot: Slot; signups: Signup[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();

  const open = slot.capacity - signups.length;
  const start = formatInTimeZone(new Date(slot.start_at), TZ, 'h:mm a');
  const end = formatInTimeZone(new Date(slot.end_at), TZ, 'h:mm a');

  return (
    <article className="rounded border border-tj-black/10 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">{start} – {end}</h3>
        <span className="text-xs opacity-60">{signups.length}/{slot.capacity}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: slot.capacity }).map((_, i) => {
          const s = signups[i];
          if (s) {
            return (
              <div key={s.id} className="rounded border border-tj-black/10 bg-tj-cream px-3 py-2 text-sm">
                {shortenName(s.name)}
              </div>
            );
          }
          return (
            <button
              key={`open-${i}`}
              onClick={() => setModalOpen(true)}
              className="rounded border border-dashed border-tj-gold bg-white px-3 py-2 text-sm text-tj-black hover:bg-tj-gold-soft"
            >
              Claim →
            </button>
          );
        })}
      </div>
      {modalOpen && (
        <ClaimForm
          slotId={slot.id}
          onClose={() => setModalOpen(false)}
          onClaimed={() => {
            setModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </article>
  );
}
```

### Task 8.3: Cancel landing page

**Files:**
- Create: `app/concessions/cancel/[token]/page.tsx`

- [ ] **Step 1:** Write:

```typescript
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatInTimeZone } from 'date-fns-tz';

export const dynamic = 'force-dynamic';
const TZ = 'America/New_York';

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: signup } = await admin
    .from('concession_signups')
    .select('id, volunteer_name, volunteer_email, cancelled_at, slot_id')
    .eq('cancel_token', token)
    .maybeSingle();

  if (!signup) {
    return (
      <main className="min-h-screen bg-tj-cream p-8">
        <div className="mx-auto max-w-md rounded border border-tj-black/10 bg-white p-6 text-sm">
          <p>This cancellation link is no longer valid.</p>
          <p className="mt-3"><Link href="/concessions" className="underline">Back to concessions</Link></p>
        </div>
      </main>
    );
  }

  let alreadyCancelled = !!signup.cancelled_at;
  let slotInfo: { start_at: string; end_at: string } | null = null;

  if (!alreadyCancelled) {
    // POST internally to cancel via the API so email + cleanup happens
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fields.poweryourleague.com';
    await fetch(`${base}/api/concessions/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    alreadyCancelled = true;
  }

  const { data: slot } = await admin
    .from('concession_slots')
    .select('start_at, end_at')
    .eq('id', signup.slot_id)
    .maybeSingle();
  slotInfo = slot ?? null;

  return (
    <main className="min-h-screen bg-tj-cream p-8">
      <div className="mx-auto max-w-md rounded border border-tj-black/10 bg-white p-6 text-sm">
        <h1 className="text-base font-semibold">Cancellation confirmed</h1>
        <p className="mt-2 opacity-80">
          {signup.volunteer_name}, your shift has been cancelled.
        </p>
        {slotInfo && (
          <p className="mt-2 text-xs opacity-70">
            {formatInTimeZone(new Date(slotInfo.start_at), TZ, 'EEEE, MMM d')} ·{' '}
            {formatInTimeZone(new Date(slotInfo.start_at), TZ, 'h:mm a')} –{' '}
            {formatInTimeZone(new Date(slotInfo.end_at), TZ, 'h:mm a')}
          </p>
        )}
        <p className="mt-4"><Link href="/concessions" className="underline">Sign up for another shift</Link></p>
      </div>
    </main>
  );
}
```

### Task 8.4: Commit

```bash
git add app/concessions/
git commit -m "feat(concessions): public list + slot detail + cancel pages"
git push
```

---

## Phase 9 — Admin

### Task 9.1: Admin nav + actions

**Files:**
- Modify: `app/admin/_components/admin-nav.tsx`
- Create: `app/admin/concessions/_actions.ts`

- [ ] **Step 1:** Add `Concessions` link to admin-nav:

```typescript
const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/coaches', label: 'Coaches' },
  { href: '/admin/fields', label: 'Fields' },
  { href: '/admin/requests', label: 'Requests' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/concessions', label: 'Concessions' },
];
```

- [ ] **Step 2:** Create `app/admin/concessions/_actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fromZonedTime } from 'date-fns-tz';

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  const admin = createAdminClient();
  const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!coach || coach.role !== 'admin') throw new Error('unauthorized');
  return { adminClient: admin, coach };
}

export async function createTournamentEvent(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { adminClient, coach } = await requireAdmin();
  const date = String(formData.get('event_date') ?? '');
  const startHour = Number(formData.get('start_hour') ?? '0');
  const endHour = Number(formData.get('end_hour') ?? '0');
  const capacity = Math.min(20, Math.max(1, Number(formData.get('capacity') ?? '2')));

  if (!date) return { ok: false, error: 'Pick a date' };
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return { ok: false, error: 'Start hour 0–23' };
  if (!Number.isInteger(endHour) || endHour <= startHour || endHour > 24) return { ok: false, error: 'End hour must be after start hour' };

  const { data: ev, error: insErr } = await adminClient
    .from('concession_events')
    .insert({ org_id: coach.org_id, event_date: date, event_type: 'tournament' })
    .select('id')
    .single();
  if (insErr || !ev) {
    if (insErr?.code === '23505') return { ok: false, error: 'A tournament already exists on that date' };
    return { ok: false, error: insErr?.message ?? 'Insert failed' };
  }

  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    const start = fromZonedTime(`${date}T${String(h).padStart(2, '0')}:00:00`, 'America/New_York');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    slots.push({ event_id: ev.id, start_at: start.toISOString(), end_at: end.toISOString(), capacity });
  }
  if (slots.length > 0) await adminClient.from('concession_slots').insert(slots);

  revalidatePath('/admin/concessions');
  revalidatePath('/concessions');
  redirect(`/admin/concessions/${ev.id}`);
}

export async function removeSignup(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { adminClient } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing signup id' };
  const { error } = await adminClient
    .from('concession_signups')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/concessions');
  return { ok: true };
}
```

### Task 9.2: Admin list page

**Files:**
- Create: `app/admin/concessions/page.tsx`
- Create: `app/admin/concessions/_components/new-tournament-form.tsx`

- [ ] **Step 1:** Write `app/admin/concessions/_components/new-tournament-form.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { createTournamentEvent } from '../_actions';

export function NewTournamentForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await createTournamentEvent(formData);
      if (!result.ok) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-3 rounded border border-tj-black/10 bg-white p-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Date</span>
        <input type="date" name="event_date" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Start hour</span>
        <input type="number" name="start_hour" min={0} max={23} defaultValue={9} required className="w-20 rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">End hour</span>
        <input type="number" name="end_hour" min={1} max={24} defaultValue={18} required className="w-20 rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Capacity/slot</span>
        <input type="number" name="capacity" min={1} max={20} defaultValue={2} required className="w-20 rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-tj-gold px-3 py-1.5 text-sm font-medium text-tj-black hover:bg-tj-gold-soft disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Create tournament'}
      </button>
      {error && <span className="basis-full text-xs text-override-red">{error}</span>}
    </form>
  );
}
```

- [ ] **Step 2:** Write `app/admin/concessions/page.tsx`:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { NewTournamentForm } from './_components/new-tournament-form';

const TZ = 'America/New_York';

export default async function AdminConcessionsPage() {
  const admin = createAdminClient();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const { data: events } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location')
    .gte('event_date', today.toISOString().slice(0, 10))
    .order('event_date');

  const eventIds = (events ?? []).map((e) => e.id);
  const { data: slots } = eventIds.length
    ? await admin.from('concession_slots').select('id, event_id, capacity').in('event_id', eventIds)
    : { data: [] };
  const { data: signups } = eventIds.length
    ? await admin
        .from('concession_signups')
        .select('slot_id')
        .is('cancelled_at', null)
        .in('slot_id', (slots ?? []).map((s) => s.id))
    : { data: [] };

  const totalCapacityByEvent = new Map<string, number>();
  const slotsByEvent = new Map<string, string[]>();
  for (const s of slots ?? []) {
    totalCapacityByEvent.set(s.event_id, (totalCapacityByEvent.get(s.event_id) ?? 0) + s.capacity);
    const ids = slotsByEvent.get(s.event_id) ?? [];
    ids.push(s.id);
    slotsByEvent.set(s.event_id, ids);
  }
  const filledBySlot = new Map<string, number>();
  for (const su of signups ?? []) filledBySlot.set(su.slot_id, (filledBySlot.get(su.slot_id) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Concession events</h2>
        <p className="text-sm opacity-70">
          Game days are auto-created from front-field rec games. Manual entry below for tournaments.
        </p>
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">New tournament</h3>
        <NewTournamentForm />
      </section>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <h3 className="border-b border-tj-black/10 bg-tj-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">
          Upcoming events
        </h3>
        <table className="w-full text-sm">
          <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
            <tr><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Filled</th><th className="p-2"></th></tr>
          </thead>
          <tbody>
            {(events ?? []).map((e) => {
              const cap = totalCapacityByEvent.get(e.id) ?? 0;
              const ids = slotsByEvent.get(e.id) ?? [];
              const filled = ids.reduce((acc, id) => acc + (filledBySlot.get(id) ?? 0), 0);
              const dateEt = new Date(`${e.event_date}T12:00:00Z`);
              return (
                <tr key={e.id} className="border-t border-tj-black/5">
                  <td className="p-2">{formatInTimeZone(dateEt, TZ, 'EEE MMM d, yyyy')}</td>
                  <td className="p-2 capitalize">{e.event_type}</td>
                  <td className="p-2">{filled}/{cap}</td>
                  <td className="p-2 text-right">
                    <Link href={`/admin/concessions/${e.id}`} className="text-xs underline">Manage →</Link>
                  </td>
                </tr>
              );
            })}
            {(events ?? []).length === 0 && (
              <tr><td colSpan={4} className="p-3 text-tj-black/50">No upcoming events.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

### Task 9.3: Admin event detail page

**Files:**
- Create: `app/admin/concessions/[eventId]/page.tsx`

- [ ] **Step 1:** Write:

```typescript
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { removeSignup } from '../_actions';

const TZ = 'America/New_York';

export default async function AdminConcessionEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location, source_game_ids')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) notFound();

  const { data: slots } = await admin
    .from('concession_slots')
    .select('id, start_at, end_at, capacity')
    .eq('event_id', event.id)
    .order('start_at');

  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: signups } = slotIds.length
    ? await admin
        .from('concession_signups')
        .select('id, slot_id, volunteer_name, volunteer_email, created_at')
        .is('cancelled_at', null)
        .in('slot_id', slotIds)
    : { data: [] };

  const signupsBySlot = new Map<string, typeof signups>();
  for (const su of signups ?? []) {
    if (!su.slot_id) continue;
    const list = signupsBySlot.get(su.slot_id) ?? [];
    list.push(su);
    signupsBySlot.set(su.slot_id, list);
  }

  const dateEt = new Date(`${event.event_date}T12:00:00Z`);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <Link href="/admin/concessions" className="text-xs underline">← All events</Link>
          <h2 className="mt-1 text-lg font-semibold">
            {formatInTimeZone(dateEt, TZ, 'EEEE, MMM d, yyyy')}
          </h2>
          <p className="text-xs opacity-70">{event.location} · {event.event_type}</p>
        </div>
        <Link
          href={`/api/concessions/export/${event.id}`}
          className="rounded border border-tj-black/20 px-3 py-1.5 text-sm hover:bg-tj-cream"
        >
          Export CSV
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        {(slots ?? []).map((slot) => {
          const list = signupsBySlot.get(slot.id) ?? [];
          return (
            <article key={slot.id} className="rounded border border-tj-black/10 bg-white p-4 text-sm">
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">
                  {formatInTimeZone(new Date(slot.start_at), TZ, 'h:mm a')} – {formatInTimeZone(new Date(slot.end_at), TZ, 'h:mm a')}
                </h3>
                <span className="text-xs opacity-60">{list.length}/{slot.capacity}</span>
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {list.map((su) => (
                  <li key={su.id} className="flex items-center justify-between gap-3 rounded bg-tj-cream px-2 py-1">
                    <span>
                      <span className="font-medium">{su.volunteer_name}</span>
                      <span className="ml-2 text-xs opacity-70">{su.volunteer_email}</span>
                    </span>
                    <form action={removeSignup}>
                      <input type="hidden" name="id" value={su.id} />
                      <button className="text-xs underline opacity-70 hover:opacity-100">Remove</button>
                    </form>
                  </li>
                ))}
                {list.length === 0 && (
                  <li className="text-xs opacity-60">No signups yet.</li>
                )}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}
```

### Task 9.4: CSV export route

**Files:**
- Create: `lib/concessions/csv.ts`
- Create: `lib/concessions/csv.test.ts`
- Create: `app/api/concessions/export/[eventId]/route.ts`

- [ ] **Step 1:** Write `lib/concessions/csv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { signupsToCsv } from './csv';

describe('signupsToCsv', () => {
  it('emits a header + one row per signup', () => {
    const csv = signupsToCsv([
      { time: '9:00 AM – 10:00 AM', name: 'Alice', email: 'a@x.com' },
      { time: '10:00 AM – 11:00 AM', name: 'Bob', email: 'b@x.com' },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Time,Name,Email');
    expect(lines[1]).toBe('9:00 AM – 10:00 AM,Alice,a@x.com');
    expect(lines[2]).toBe('10:00 AM – 11:00 AM,Bob,b@x.com');
  });

  it('quotes fields containing commas or quotes', () => {
    const csv = signupsToCsv([
      { time: '9:00 AM – 10:00 AM', name: 'Smith, John', email: 'js@x.com' },
      { time: '10:00 AM – 11:00 AM', name: 'O\'Brien "Pat"', email: 'pat@x.com' },
    ]);
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"O\'Brien ""Pat"""');
  });
});
```

- [ ] **Step 2:** Write `lib/concessions/csv.ts`:

```typescript
type Row = { time: string; name: string; email: string };

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function signupsToCsv(rows: Row[]): string {
  const lines = ['Time,Name,Email'];
  for (const r of rows) {
    lines.push([r.time, r.name, r.email].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 3:** Run tests — expect green.

- [ ] **Step 4:** Write `app/api/concessions/export/[eventId]/route.ts`:

```typescript
import 'server-only';
import { NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { signupsToCsv } from '@/lib/concessions/csv';

const TZ = 'America/New_York';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  const { data: me } = await admin
    .from('coaches').select('role').eq('auth_user_id', user.id).maybeSingle();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { eventId } = await params;
  const { data: event } = await admin
    .from('concession_events').select('id, event_date').eq('id', eventId).maybeSingle();
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: slots } = await admin
    .from('concession_slots').select('id, start_at, end_at').eq('event_id', eventId).order('start_at');
  const { data: signups } = await admin
    .from('concession_signups')
    .select('slot_id, volunteer_name, volunteer_email')
    .is('cancelled_at', null)
    .in('slot_id', (slots ?? []).map((s) => s.id));

  const slotById = new Map((slots ?? []).map((s) => [s.id, s]));
  const rows = (signups ?? [])
    .map((su) => {
      const slot = slotById.get(su.slot_id);
      if (!slot) return null;
      const time = `${formatInTimeZone(new Date(slot.start_at), TZ, 'h:mm a')} – ${formatInTimeZone(new Date(slot.end_at), TZ, 'h:mm a')}`;
      return { time, name: su.volunteer_name, email: su.volunteer_email };
    })
    .filter((r): r is { time: string; name: string; email: string } => r !== null)
    .sort((a, b) => a.time.localeCompare(b.time));

  const csv = signupsToCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="concessions-${event.event_date}.csv"`,
    },
  });
}
```

### Task 9.5: Commit

```bash
git add app/admin/concessions/ app/api/concessions/export/ lib/concessions/csv.ts lib/concessions/csv.test.ts
git commit -m "feat(admin): concession management — list, new tournament, detail, CSV export"
git push
```

---

## Phase 10 — Local QA + deploy

### Task 10.1: Manual QA

- [ ] **Step 1:** Run dev server (`npm run dev`), open `http://localhost:3001/concessions` in incognito → confirm public page renders.
- [ ] **Step 2:** As admin, go to `/admin/concessions` → create the May 16 tournament (date=2026-05-16, 9–18, capacity=2) → confirms redirect to detail page with 9 slots.
- [ ] **Step 3:** Open the public detail page in incognito → claim one slot with name + your email → check inbox for confirmation.
- [ ] **Step 4:** Click cancel link in email → lands on cancel page → check inbox for cancellation email.
- [ ] **Step 5:** As admin, go to event detail → click Export CSV → confirm download with headers + rows.
- [ ] **Step 6:** Manually trigger the cron route locally:

```bash
node --env-file=.env.local -e "process.stdout.write(process.env.CRON_SECRET)" | xargs -I{} curl -sS -X POST -H "Authorization: Bearer {}" http://localhost:3001/api/cron/generate-concessions
```

Should return `{ ok: true, events_inserted: N, slots_inserted: M }` for front-field games over the next 14 days.

### Task 10.2: Deploy + push GitHub Actions secret check

- [ ] **Step 1:** Deploy:

```bash
npx vercel@latest --prod --yes
```

- [ ] **Step 2:** Smoke test prod:

```bash
curl -sI https://fields.poweryourleague.com/concessions
```
Expected: 200.

- [ ] **Step 3:** Verify GitHub Actions has `CRON_SECRET` set (it should from Session 5 — confirm). Manually trigger both workflows once each to validate (`hourly-sync.yml` and `daily-reminders.yml`).

### Task 10.3: Session handoff

**Files:**
- Create: `docs/sessions/SESSION_7_concessions.md`

- [ ] **Step 1:** Write a handoff documenting what shipped, the email-not-SMS deviation, the field-id approach instead of regex, dual feeds, and what manual seed Meesh should do (the May 16 tournament).
- [ ] **Step 2:** Commit:

```bash
git add docs/sessions/SESSION_7_concessions.md
git commit -m "docs(session-7): handoff — concessions module, email-based, dual iCal feeds"
git push
```

---

## Self-review

**Spec coverage:**

| Spec section | Tasks |
|---|---|
| Migration: events/slots/signups + trigger + RLS | 1.1, 1.2 |
| Dual iCal feeds | 2.1, 2.2, 2.3, 2.4 |
| Front-field detection (via field_id, not regex) | 4.1 |
| Slot generation: 30-min pre-buffer, 2-hr block, merge overlaps | 3.1, 3.2 |
| Skip dates that already have an event | 4.1 (idempotent upsert) |
| Tournament events (manual, 1-hr slots) | 9.1 (`createTournamentEvent`) |
| Public list page `/concessions` | 8.1 |
| Public slot grid `/concessions/[eventId]` | 8.2 |
| Public claim modal with name+email | 8.2 |
| `/concessions/cancel/[token]` | 8.3 |
| Cancel via tokenized email link | 6.2 + 8.3 |
| Admin event list + manual tournament | 9.2 |
| Admin add/remove signup | 9.3 (`removeSignup`) |
| CSV export | 9.4 |
| `/api/concessions/claim` + email confirm | 6.1, 5.1 |
| `/api/concessions/cancel` + email confirm | 6.2, 5.1 |
| Day-of reminder cron | 7.1, 7.2 |
| Email templates (confirm / cancel / reminder) | 5.1 |
| Capacity enforcement at DB level | 1.1 (trigger) |
| One person per slot uniqueness | 1.1 (partial unique index) |
| Phone normalization | **Skipped — email instead per Meesh's call** |
| Twilio SMS confirmation/reminder | **Skipped — email instead per Meesh's call** |
| Admin trigger reminder send manually | Implicit — manual `workflow_dispatch` on daily workflow works for this |

**Placeholder scan:** none.

**Type consistency:**

- `GameBlock` in `lib/concessions/generate.ts` matches the shape consumed by `app/api/cron/generate-concessions/route.ts`.
- `Row` in `lib/concessions/csv.ts` matches the rows constructed in `app/api/concessions/export/[eventId]/route.ts`.
- Form data parsing in server actions consistently uses `String(formData.get(...))` and validates types.
- `cancel_token` is a string everywhere (DB default `encode(gen_random_bytes(16), 'hex')`).
