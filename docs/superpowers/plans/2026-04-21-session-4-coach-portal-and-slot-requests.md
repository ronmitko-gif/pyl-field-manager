# Session 4 — Coach Portal + Slot Requests (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the coach portal, the slot request flow, the admin approval queue, and transactional email via Resend. A coach should be able to log in, request a Friday 8–10pm slot, and receive an email confirmation after admin approves it.

**Architecture:** A new `open_windows` config table replaces the Session 1 practice of pre-seeding `open_slot` blocks. Request validation is a pure TS function tested against fixtures. Coach and admin pages are RSCs; the date-dependent time-picker is a small client component. Email sends directly to Resend's REST API (no npm dep) and are logged to the existing `notifications` table.

**Tech Stack:** Next.js 16 App Router (RSCs + server actions + one `'use client'` component), TypeScript strict, Tailwind v4 (TJ palette from Session 2), `@supabase/ssr` + `@supabase/supabase-js`, `date-fns` + `date-fns-tz`, `vitest`. Resend REST API via native `fetch`.

---

## Preconditions

- [x] Sessions 1–3 shipped
- [x] Spec approved at `docs/superpowers/specs/2026-04-21-session-4-coach-portal-and-slot-requests-design.md`
- [x] Supabase project already has: `schedule_blocks`, `slot_requests`, `notifications`, `coaches`, `teams`, `fields`, `travel_recurring_slots`
- [x] TJ palette tokens in `app/globals.css`
- [x] Resend account exists (Meesh has it for auth SMTP) — we'll create a new API key for server-side sends

---

## File structure at end of session

```
supabase/
  migrations/
    0002_open_windows.sql                  (new)
  seed.sql                                 (modify — remove open_slot inserts, add open_windows)

lib/
  email/
    send.ts                                (new — Resend wrapper)
  notifications/
    enqueue.ts                             (new — DB log + send)
  requests/
    windows.ts                             (new — pure helpers)
    windows.test.ts                        (new)
    validate.ts                            (new — server-only)
    validate.test.ts                       (new)
    helpers.ts                             (new — duration/time utilities shared with UI)

app/
  admin/
    _actions.ts                            (modify — add approveSlotRequest, denySlotRequest)
    _components/
      admin-nav.tsx                        (modify — add Requests link + badge)
    layout.tsx                             (modify — fetch pending count, pass to AdminNav)
    requests/
      page.tsx                             (new — approval queue)
  coach/
    page.tsx                               (rewrite — real portal)
    _actions.ts                            (new — submitSlotRequest, withdrawSlotRequest, cancelOwnBlock)
    _components/
      request-form.tsx                     (new — client; date-driven time picker)
      upcoming-block-row.tsx               (new — server; with Cancel button)
      pending-request-row.tsx              (new — server; with Withdraw button)
    error.tsx                              (new — friendly error boundary)

.env.example                               (modify — add RESEND_API_KEY placeholder)
.env.local                                 (modify — set RESEND_API_KEY)

docs/sessions/
  SESSION_4_coach_portal.md                (new — handoff)
```

No app-code changes to existing admin dashboard (`/admin/page.tsx`) beyond the layout-level badge.

---

## Phase 1 — Schema migration + seed

### Task 1.1: Write the migration

Create `supabase/migrations/0002_open_windows.sql`:

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

-- One-time cleanup: wipe any pre-seeded open_slot blocks that are still in the future.
delete from schedule_blocks
  where source = 'open_slot'
    and start_at >= current_date;
```

### Task 1.2: Update `supabase/seed.sql`

Remove the `Open slot blocks` insert at the bottom and append `open_windows` seeds:

Find and delete the entire `Open slot blocks: next 4 weeks ...` block (the one that does `insert into schedule_blocks ... source='open_slot'`).

Append at the end of `supabase/seed.sql`:

```sql
-- Open windows (Session 4): 885 Back Field
insert into open_windows (org_id, field_id, day_of_week, start_time, end_time)
  select o.id, f.id, v.dow, v.start_t, v.end_t
  from organizations o
  join fields f on f.org_id = o.id and f.name = '885 Back Field',
    (values
      (5, '20:00'::time, '22:00'::time),   -- Friday 8-10pm
      (6, '11:00'::time, '19:00'::time),   -- Saturday 11am-7pm
      (0, '09:00'::time, '19:00'::time)    -- Sunday 9am-7pm
    ) as v(dow, start_t, end_t)
  where o.slug = 'tjybb'
    and not exists (
      select 1 from open_windows w
      where w.org_id = o.id
        and w.field_id = f.id
        and w.day_of_week = v.dow
        and w.start_time = v.start_t
    );
```

### Task 1.3: Apply migration + seed via Supabase Dashboard

- [ ] **Step 1:** Meesh opens Supabase Dashboard → SQL Editor → paste contents of `supabase/migrations/0002_open_windows.sql` → Run
- [ ] **Step 2:** Paste contents of the new `open_windows` insert block (just the appended piece from Task 1.2) → Run
- [ ] **Step 3:** Verify: `select count(*) from open_windows;` returns 3
- [ ] **Step 4:** Verify: `select count(*) from schedule_blocks where source='open_slot' and start_at >= current_date;` returns 0

### Task 1.4: Commit

```bash
git add supabase/
git commit -m "feat(db): open_windows table; remove open_slot pre-seeding"
git push
```

---

## Phase 2 — Window math helpers (TDD)

### Task 2.1: Write failing test

Create `lib/requests/windows.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { windowsForDate, fitsInWindow } from './windows';
import type { OpenWindow } from './windows';

const BACK = 'field-back';
const FRONT = 'field-front';

const WINDOWS: OpenWindow[] = [
  { id: 'w1', field_id: BACK, day_of_week: 5, start_time: '20:00:00', end_time: '22:00:00' }, // Fri
  { id: 'w2', field_id: BACK, day_of_week: 6, start_time: '11:00:00', end_time: '19:00:00' }, // Sat
  { id: 'w3', field_id: BACK, day_of_week: 0, start_time: '09:00:00', end_time: '19:00:00' }, // Sun
];

describe('windowsForDate', () => {
  it('returns the Saturday window for a Saturday ET date on Back field', () => {
    // Saturday April 25 2026
    const dateEt = new Date('2026-04-25T12:00:00-04:00');
    const result = windowsForDate(WINDOWS, BACK, dateEt);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('w2');
  });

  it('returns [] for a Monday (no window on that dow)', () => {
    const dateEt = new Date('2026-04-20T12:00:00-04:00'); // Monday
    expect(windowsForDate(WINDOWS, BACK, dateEt)).toEqual([]);
  });

  it('returns [] for a different field on a window dow', () => {
    const dateEt = new Date('2026-04-25T12:00:00-04:00');
    expect(windowsForDate(WINDOWS, FRONT, dateEt)).toEqual([]);
  });
});

describe('fitsInWindow', () => {
  const saturdayWindow = WINDOWS[1]; // 11:00-19:00 Sat
  it('accepts a range inside the window (ET)', () => {
    const start = new Date('2026-04-25T14:00:00-04:00'); // 2pm ET
    const end = new Date('2026-04-25T16:00:00-04:00');   // 4pm ET
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(true);
  });

  it('accepts a range exactly matching the window', () => {
    const start = new Date('2026-04-25T11:00:00-04:00');
    const end = new Date('2026-04-25T19:00:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(true);
  });

  it('rejects a range that starts before the window', () => {
    const start = new Date('2026-04-25T10:30:00-04:00');
    const end = new Date('2026-04-25T12:00:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(false);
  });

  it('rejects a range that ends after the window', () => {
    const start = new Date('2026-04-25T18:00:00-04:00');
    const end = new Date('2026-04-25T19:30:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(false);
  });

  it('rejects a range on a different weekday than the window', () => {
    const start = new Date('2026-04-24T14:00:00-04:00'); // Friday
    const end = new Date('2026-04-24T16:00:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(false);
  });
});
```

Run: `npm test`. Expected: FAIL (module not found).

### Task 2.2: Implement helpers

Create `lib/requests/windows.ts`:

```typescript
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/New_York';

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
): OpenWindow[] {
  const local = toZonedTime(dateEt, TZ);
  const dow = local.getDay();
  return windows.filter(
    (w) => w.field_id === fieldId && w.day_of_week === dow
  );
}

function parseTimeOnDate(isoDate: string, hms: string): Date {
  // hms is "HH:MM:SS"
  const [h, m] = hms.split(':').map(Number);
  const [y, mo, d] = isoDate.split('-').map(Number);
  // Build an ET-wall-clock instant; fromZonedTime for ET→UTC (not needed since
  // we compare ET fields directly below). Return a Date anchored to ET.
  const dt = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  return dt;
}

export function fitsInWindow(
  window: OpenWindow,
  startAtUtc: Date,
  endAtUtc: Date
): boolean {
  const startEt = toZonedTime(startAtUtc, TZ);
  const endEt = toZonedTime(endAtUtc, TZ);
  if (startEt.getDay() !== window.day_of_week) return false;
  if (endEt.getDay() !== window.day_of_week) return false; // no cross-midnight

  const isoDate = format(startEt, 'yyyy-MM-dd');
  const winStart = parseTimeOnDate(isoDate, window.start_time);
  const winEnd = parseTimeOnDate(isoDate, window.end_time);

  // Compare on ET-wall-clock basis by reconstructing the ET date as UTC-anchored.
  const startEtAsUtc = new Date(
    Date.UTC(
      startEt.getFullYear(),
      startEt.getMonth(),
      startEt.getDate(),
      startEt.getHours(),
      startEt.getMinutes(),
      0
    )
  );
  const endEtAsUtc = new Date(
    Date.UTC(
      endEt.getFullYear(),
      endEt.getMonth(),
      endEt.getDate(),
      endEt.getHours(),
      endEt.getMinutes(),
      0
    )
  );

  return startEtAsUtc >= winStart && endEtAsUtc <= winEnd;
}
```

Run: `npm test`. Expected: all 8 pass.

### Task 2.3: Commit

```bash
git add lib/requests/windows.ts lib/requests/windows.test.ts
git commit -m "feat(requests): windowsForDate + fitsInWindow helpers (DST-safe)"
git push
```

---

## Phase 3 — Shared time helpers + request validator (TDD)

### Task 3.1: Write failing test for validator

Create `lib/requests/validate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateSlotRequest } from './validate';
import type { OpenWindow } from './windows';

const BACK = 'field-back';
const ORG = 'org-tjybb';
const COACH = 'coach-1';

const WINDOWS: OpenWindow[] = [
  { id: 'w2', field_id: BACK, day_of_week: 6, start_time: '11:00:00', end_time: '19:00:00' },
];

// Mock admin client: returns fixed lists based on the table queried.
function makeMockAdmin(opts: {
  windows?: OpenWindow[];
  existingBlocks?: { start_at: string; end_at: string; field_id: string; status: string }[];
  pendingRequests?: { start_at: string; end_at: string; field_id: string; requester_coach_id: string }[];
}) {
  const { windows = [], existingBlocks = [], pendingRequests = [] } = opts;
  return {
    from(table: string) {
      if (table === 'open_windows') {
        return { select: () => ({ eq: () => Promise.resolve({ data: windows, error: null }) }) };
      }
      if (table === 'schedule_blocks') {
        return {
          select: () => ({
            eq: (_c: string, _v: string) => ({
              in: () => Promise.resolve({ data: existingBlocks, error: null }),
            }),
          }),
        };
      }
      if (table === 'slot_requests') {
        return {
          select: () => ({
            eq: (_c: string, _v: string) => ({
              eq: () => Promise.resolve({ data: pendingRequests, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe('validateSlotRequest', () => {
  const goodInput = {
    field_id: BACK,
    start_at: new Date('2026-04-25T18:00:00Z'), // Sat 2pm ET
    end_at: new Date('2026-04-25T20:00:00Z'),   // Sat 4pm ET
    requester_coach_id: COACH,
  };

  it('passes a clean 2-hour Saturday afternoon slot', async () => {
    const admin = makeMockAdmin({ windows: WINDOWS });
    const result = await validateSlotRequest(admin, ORG, goodInput);
    expect(result).toEqual({ ok: true });
  });

  it('rejects when end <= start', async () => {
    const admin = makeMockAdmin({ windows: WINDOWS });
    const result = await validateSlotRequest(admin, ORG, {
      ...goodInput,
      end_at: new Date('2026-04-25T18:00:00Z'),
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('before') });
  });

  it('rejects when duration > 3h', async () => {
    const admin = makeMockAdmin({ windows: WINDOWS });
    const result = await validateSlotRequest(admin, ORG, {
      ...goodInput,
      end_at: new Date('2026-04-25T22:00:00Z'), // 4h
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('3 hours');
  });

  it('rejects when not on 30-min boundaries', async () => {
    const admin = makeMockAdmin({ windows: WINDOWS });
    const result = await validateSlotRequest(admin, ORG, {
      ...goodInput,
      start_at: new Date('2026-04-25T18:15:00Z'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('30');
  });

  it('rejects when outside any open window', async () => {
    const admin = makeMockAdmin({ windows: WINDOWS });
    const result = await validateSlotRequest(admin, ORG, {
      ...goodInput,
      start_at: new Date('2026-04-25T22:00:00Z'), // Sat 6pm ET; window ends 7pm, fits
      end_at: new Date('2026-04-26T02:00:00Z'),   // Sun 10pm ET — crosses midnight, no match
    });
    expect(result.ok).toBe(false);
  });

  it('rejects when the field has an existing confirmed block overlapping', async () => {
    const admin = makeMockAdmin({
      windows: WINDOWS,
      existingBlocks: [
        {
          start_at: '2026-04-25T19:00:00Z',
          end_at: '2026-04-25T20:30:00Z',
          field_id: BACK,
          status: 'confirmed',
        },
      ],
    });
    const result = await validateSlotRequest(admin, ORG, goodInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('already booked');
  });

  it('rejects when the coach has an overlapping pending request', async () => {
    const admin = makeMockAdmin({
      windows: WINDOWS,
      pendingRequests: [
        {
          start_at: '2026-04-25T18:00:00Z',
          end_at: '2026-04-25T20:00:00Z',
          field_id: BACK,
          requester_coach_id: COACH,
        },
      ],
    });
    const result = await validateSlotRequest(admin, ORG, goodInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('pending');
  });
});
```

Run: `npm test`. Expected: FAIL.

### Task 3.2: Implement validator

Create `lib/requests/validate.ts`:

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpenWindow } from './windows';
import { windowsForDate, fitsInWindow } from './windows';

type Input = {
  field_id: string;
  start_at: Date;
  end_at: Date;
  requester_coach_id: string;
};

type ValidationResult = { ok: true } | { ok: false; reason: string };

const MAX_DURATION_MS = 3 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

export async function validateSlotRequest(
  admin: SupabaseClient,
  orgId: string,
  input: Input
): Promise<ValidationResult> {
  const { field_id, start_at, end_at, requester_coach_id } = input;

  if (end_at.getTime() <= start_at.getTime()) {
    return { ok: false, reason: 'End time must be after start time.' };
  }
  const durationMs = end_at.getTime() - start_at.getTime();
  if (durationMs > MAX_DURATION_MS) {
    return { ok: false, reason: 'Slots are capped at 3 hours.' };
  }
  if (start_at.getTime() % HALF_HOUR_MS !== 0) {
    return { ok: false, reason: 'Start must be on a 30-minute boundary.' };
  }
  if (end_at.getTime() % HALF_HOUR_MS !== 0) {
    return { ok: false, reason: 'End must be on a 30-minute boundary.' };
  }

  const { data: windowRows, error: winErr } = await admin
    .from('open_windows')
    .select('id, field_id, day_of_week, start_time, end_time')
    .eq('org_id', orgId);
  if (winErr) return { ok: false, reason: `Couldn't load open windows: ${winErr.message}` };
  const windows = (windowRows ?? []) as OpenWindow[];

  const dayWindows = windowsForDate(windows, field_id, start_at);
  const fits = dayWindows.some((w) => fitsInWindow(w, start_at, end_at));
  if (!fits) {
    return { ok: false, reason: 'This time is outside any open window for the field.' };
  }

  const { data: overlappingBlocks, error: blockErr } = await admin
    .from('schedule_blocks')
    .select('id, start_at, end_at, field_id, status')
    .eq('field_id', field_id)
    .in('status', ['confirmed', 'tentative']);
  if (blockErr) return { ok: false, reason: `Couldn't load existing blocks: ${blockErr.message}` };

  const overlaps = (overlappingBlocks ?? []).some((b) => {
    const bs = new Date(b.start_at).getTime();
    const be = new Date(b.end_at).getTime();
    return bs < end_at.getTime() && be > start_at.getTime();
  });
  if (overlaps) {
    return { ok: false, reason: 'That field is already booked during that time.' };
  }

  const { data: pending, error: pendErr } = await admin
    .from('slot_requests')
    .select('id, start_at, end_at, field_id, requester_coach_id')
    .eq('requester_coach_id', requester_coach_id)
    .eq('status', 'pending');
  if (pendErr) return { ok: false, reason: `Couldn't load pending requests: ${pendErr.message}` };

  const hasPendingOverlap = (pending ?? []).some((p) => {
    if (p.field_id !== field_id) return false;
    const ps = new Date(p.start_at).getTime();
    const pe = new Date(p.end_at).getTime();
    return ps < end_at.getTime() && pe > start_at.getTime();
  });
  if (hasPendingOverlap) {
    return { ok: false, reason: 'You already have a pending request that overlaps this time.' };
  }

  return { ok: true };
}
```

Run: `npm test`. Expected: all validator tests pass.

### Task 3.3: Commit

```bash
git add lib/requests/
git commit -m "feat(requests): validateSlotRequest with 5-gate validation + tests"
git push
```

---

## Phase 4 — Email sending + notification enqueue

### Task 4.1: Resend API key setup

- [ ] **Step 1:** Meesh creates a new Resend API key at https://resend.com/api-keys (restricted: "Sending access" + domain `poweryourleague.com`).
- [ ] **Step 2:** Add to `.env.local`:

```
RESEND_API_KEY=re_yourkey
```

- [ ] **Step 3:** Add to `.env.example`:

Add this section before the last section of `.env.example`:

```
# --- Email notifications (Session 4) ---------------------------------------
# Server-side transactional emails via Resend. Create a key at https://resend.com/api-keys
# with sending access for the poweryourleague.com domain.
RESEND_API_KEY=
```

### Task 4.2: Implement email sender

Create `lib/email/send.ts`:

```typescript
import 'server-only';

type EmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const FROM = 'PYL Field Manager <noreply@poweryourleague.com>';

export async function sendEmail(input: EmailInput): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id: string };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

### Task 4.3: Notification enqueue wrappers

Create `lib/notifications/enqueue.ts`:

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatInTimeZone } from 'date-fns-tz';
import { sendEmail } from '@/lib/email/send';

const TZ = 'America/New_York';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fields.poweryourleague.com';

type Coach = { id: string; name: string; email: string; team_id: string | null };
type Request = {
  id: string;
  start_at: string;
  end_at: string;
  field_id: string;
  requester_coach_id: string;
  admin_note: string | null;
};

async function persistAndSend(
  admin: SupabaseClient,
  params: {
    orgId: string;
    coachId: string;
    requestId: string | null;
    blockId: string | null;
    subject: string;
    html: string;
    to: string;
  }
) {
  const { data: row } = await admin
    .from('notifications')
    .insert({
      org_id: params.orgId,
      coach_id: params.coachId,
      request_id: params.requestId,
      block_id: params.blockId,
      channel: 'email',
      body: params.html.slice(0, 4000),
      status: 'pending',
    })
    .select('id')
    .single();

  const result = await sendEmail({
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  if (row?.id) {
    if (result.ok) {
      await admin
        .from('notifications')
        .update({ status: 'sent', external_id: result.id, sent_at: new Date().toISOString() })
        .eq('id', row.id);
    } else {
      await admin
        .from('notifications')
        .update({ status: 'failed', error_message: result.error })
        .eq('id', row.id);
    }
  }
}

function fmtWhen(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${formatInTimeZone(s, TZ, 'EEE MMM d')}, ${formatInTimeZone(s, TZ, 'h:mm a')}–${formatInTimeZone(e, TZ, 'h:mm a')}`;
}

export async function notifyRequestSubmitted(
  admin: SupabaseClient,
  orgId: string,
  request: Request,
  requester: Coach,
  fieldName: string,
  teamName: string
) {
  const { data: admins } = await admin
    .from('coaches')
    .select('id, email, name')
    .eq('org_id', orgId)
    .eq('role', 'admin');

  const when = fmtWhen(request.start_at, request.end_at);
  const html = `
    <p>A slot request needs your review.</p>
    <ul>
      <li><strong>${requester.name}</strong> (${teamName})</li>
      <li>${fieldName}</li>
      <li>${when}</li>
    </ul>
    <p>Approve or deny: <a href="${SITE}/admin/requests">${SITE}/admin/requests</a></p>
  `;

  for (const a of admins ?? []) {
    if (!a.email) continue;
    await persistAndSend(admin, {
      orgId,
      coachId: a.id,
      requestId: request.id,
      blockId: null,
      subject: `New slot request: ${teamName} on ${formatInTimeZone(new Date(request.start_at), TZ, 'EEE MMM d')}`,
      html,
      to: a.email,
    });
  }
}

export async function notifyRequestApproved(
  admin: SupabaseClient,
  orgId: string,
  request: Request,
  requester: Coach,
  fieldName: string,
  blockId: string
) {
  const when = fmtWhen(request.start_at, request.end_at);
  const html = `
    <p>Your slot is confirmed.</p>
    <p><strong>${fieldName}</strong> — ${when}</p>
    ${request.admin_note ? `<p>Note from admin: ${request.admin_note}</p>` : ''}
    <p>See your schedule: <a href="${SITE}/coach">${SITE}/coach</a></p>
  `;
  await persistAndSend(admin, {
    orgId,
    coachId: requester.id,
    requestId: request.id,
    blockId,
    subject: 'Your slot is confirmed',
    html,
    to: requester.email,
  });
}

export async function notifyRequestDenied(
  admin: SupabaseClient,
  orgId: string,
  request: Request,
  requester: Coach,
  fieldName: string,
  superseded = false
) {
  const when = fmtWhen(request.start_at, request.end_at);
  const reason = superseded
    ? "Another team's request for the same slot was approved first."
    : request.admin_note || 'No reason given.';
  const html = `
    <p>Your slot request was declined.</p>
    <p><strong>${fieldName}</strong> — ${when}</p>
    <p>Reason: ${reason}</p>
    <p>Request another at <a href="${SITE}/coach">${SITE}/coach</a></p>
  `;
  await persistAndSend(admin, {
    orgId,
    coachId: requester.id,
    requestId: request.id,
    blockId: null,
    subject: superseded ? 'Your slot request was declined (slot filled)' : 'Your slot request was declined',
    html,
    to: requester.email,
  });
}
```

### Task 4.4: Commit

```bash
git add lib/email/ lib/notifications/ .env.example
git commit -m "feat(email): Resend sender + notification enqueue helpers with DB audit"
git push
```

---

## Phase 5 — Coach portal + actions

### Task 5.1: Coach server actions

Create `app/coach/_actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateSlotRequest } from '@/lib/requests/validate';
import { notifyRequestSubmitted } from '@/lib/notifications/enqueue';

async function requireCoach() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  const admin = createAdminClient();
  const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, role, team_id, name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!coach) throw new Error('unauthorized');
  return { adminClient: admin, coach };
}

export async function submitSlotRequest(formData: FormData) {
  const { adminClient, coach } = await requireCoach();
  if (!coach.team_id) throw new Error('You must be assigned to a team.');

  const fieldId = String(formData.get('field_id') ?? '');
  const date = String(formData.get('date') ?? '');
  const startHms = String(formData.get('start_time') ?? '');
  const durationMin = Number(formData.get('duration_minutes') ?? '0');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!fieldId || !date || !startHms || !durationMin) {
    throw new Error('Missing required fields.');
  }

  // Build ET wall-clock instant → UTC.
  const { fromZonedTime } = await import('date-fns-tz');
  const startAt = fromZonedTime(`${date}T${startHms}`, 'America/New_York');
  const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

  const validation = await validateSlotRequest(adminClient, coach.org_id, {
    field_id: fieldId,
    start_at: startAt,
    end_at: endAt,
    requester_coach_id: coach.id,
  });
  if (!validation.ok) throw new Error(validation.reason);

  const { data: reqRow, error } = await adminClient
    .from('slot_requests')
    .insert({
      org_id: coach.org_id,
      requesting_team_id: coach.team_id,
      requester_coach_id: coach.id,
      field_id: fieldId,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      status: 'pending',
      admin_note: note,
    })
    .select('id, start_at, end_at, field_id, requester_coach_id, admin_note')
    .single();
  if (error || !reqRow) throw new Error(`Insert failed: ${error?.message ?? 'unknown'}`);

  const { data: field } = await adminClient.from('fields').select('name').eq('id', fieldId).maybeSingle();
  const { data: team } = await adminClient.from('teams').select('name').eq('id', coach.team_id).maybeSingle();

  await notifyRequestSubmitted(
    adminClient,
    coach.org_id,
    reqRow,
    coach,
    field?.name ?? 'Unknown field',
    team?.name ?? 'Unknown team'
  );

  revalidatePath('/coach');
  revalidatePath('/admin/requests');
  revalidatePath('/admin');
}

export async function withdrawSlotRequest(formData: FormData) {
  const { adminClient, coach } = await requireCoach();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing request id');

  const { error } = await adminClient
    .from('slot_requests')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('requester_coach_id', coach.id)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);

  revalidatePath('/coach');
  revalidatePath('/admin/requests');
}

export async function cancelOwnBlock(formData: FormData) {
  const { adminClient, coach } = await requireCoach();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing block id');

  // Coach can only cancel blocks for their team that are in the future.
  const { data: block } = await adminClient
    .from('schedule_blocks')
    .select('id, team_id, start_at, status')
    .eq('id', id)
    .maybeSingle();
  if (!block) throw new Error('Block not found');
  if (block.team_id !== coach.team_id) throw new Error('Not your team');
  if (new Date(block.start_at) < new Date()) throw new Error('Cannot cancel past blocks');

  const { error } = await adminClient
    .from('schedule_blocks')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/coach');
  revalidatePath('/admin');
}
```

### Task 5.2: Request form (client component)

Create `app/coach/_components/request-form.tsx`:

```typescript
'use client';

import { useMemo, useState } from 'react';
import { submitSlotRequest } from '../_actions';
import type { OpenWindow } from '@/lib/requests/windows';

type Field = { id: string; name: string };

const DURATIONS_MIN = [60, 90, 120, 150, 180];

function formatHM(totalMin: number) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function timeOptions(window: OpenWindow, durationMin: number): string[] {
  // Start options in 30-min increments from window.start_time up to
  // window.end_time - durationMin.
  const [ws, wsm] = window.start_time.split(':').slice(0, 2).map(Number);
  const [we, wem] = window.end_time.split(':').slice(0, 2).map(Number);
  const startMin = ws * 60 + wsm;
  const endMin = we * 60 + wem;
  const lastStart = endMin - durationMin;
  if (lastStart < startMin) return [];
  const options: string[] = [];
  for (let m = startMin; m <= lastStart; m += 30) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    options.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
  }
  return options;
}

function displayTime(hms: string): string {
  const [h, m] = hms.split(':').slice(0, 2).map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dowOf(isoDate: string): number {
  // ISO 'YYYY-MM-DD' in ET — pick a noon-ish UTC to stay inside the day.
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 12, 0)).getUTCDay();
}

function datesAhead(weeks: number): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const iso = `${y}-${m}-${day}`;
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    out.push({ iso, label });
  }
  return out;
}

export function RequestForm({
  fields,
  windows,
}: {
  fields: Field[];
  windows: OpenWindow[];
}) {
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [durationMin, setDurationMin] = useState(120);
  const [startTime, setStartTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dates = useMemo(() => {
    const available = datesAhead(4).filter((d) =>
      windows.some((w) => w.field_id === fieldId && w.day_of_week === dowOf(d.iso))
    );
    return available;
  }, [fieldId, windows]);

  const activeWindow = useMemo(() => {
    if (!date) return null;
    return (
      windows.find(
        (w) => w.field_id === fieldId && w.day_of_week === dowOf(date)
      ) ?? null
    );
  }, [fieldId, date, windows]);

  const startOptions = useMemo(() => {
    if (!activeWindow) return [];
    return timeOptions(activeWindow, durationMin);
  }, [activeWindow, durationMin]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setSubmitting(true);
    try {
      await submitSlotRequest(formData);
      // Form resets on revalidation; nothing else to do.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit} className="flex max-w-xl flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Field</span>
        <select
          name="field_id"
          value={fieldId}
          onChange={(e) => {
            setFieldId(e.target.value);
            setDate('');
            setStartTime('');
          }}
          className="rounded border border-tj-black/20 px-2 py-1"
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Date</span>
        <select
          name="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); setStartTime(''); }}
          className="rounded border border-tj-black/20 px-2 py-1"
        >
          <option value="">Pick a date</option>
          {dates.map((d) => (
            <option key={d.iso} value={d.iso}>{d.label}</option>
          ))}
        </select>
        {dates.length === 0 && (
          <span className="text-xs opacity-60">No open windows on this field in the next 4 weeks.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Duration</span>
        <select
          name="duration_minutes"
          value={durationMin}
          onChange={(e) => { setDurationMin(Number(e.target.value)); setStartTime(''); }}
          className="rounded border border-tj-black/20 px-2 py-1"
        >
          {DURATIONS_MIN.map((d) => (
            <option key={d} value={d}>{formatHM(d)}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Start time</span>
        <select
          name="start_time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          disabled={!date || startOptions.length === 0}
          className="rounded border border-tj-black/20 px-2 py-1 disabled:opacity-60"
        >
          <option value="">Pick a start time</option>
          {startOptions.map((t) => (
            <option key={t} value={t}>{displayTime(t)}</option>
          ))}
        </select>
        {date && startOptions.length === 0 && (
          <span className="text-xs opacity-60">No start times fit that duration in this window.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Note (optional)</span>
        <textarea name="note" rows={2} maxLength={300} className="rounded border border-tj-black/20 px-2 py-1" />
      </label>

      <div>
        <button
          type="submit"
          disabled={!fieldId || !date || !startTime || submitting}
          className="rounded bg-tj-gold px-3 py-1.5 font-medium text-tj-black hover:bg-tj-gold-soft disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Request slot'}
        </button>
      </div>

      {error && <p className="text-sm text-override-red">{error}</p>}
    </form>
  );
}
```

### Task 5.3: Upcoming block row + Pending request row

Create `app/coach/_components/upcoming-block-row.tsx`:

```typescript
import { formatInTimeZone } from 'date-fns-tz';
import { cancelOwnBlock } from '../_actions';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

export function UpcomingBlockRow({
  block,
  fieldName,
}: {
  block: ScheduleBlock;
  fieldName: string;
}) {
  const start = new Date(block.start_at);
  const end = new Date(block.end_at);
  const isCancelled = block.status === 'cancelled';
  return (
    <li className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
      <div>
        <div className={`font-medium ${isCancelled ? 'line-through opacity-60' : ''}`}>
          {formatInTimeZone(start, TZ, 'EEE MMM d')} · {formatInTimeZone(start, TZ, 'h:mm a')}–{formatInTimeZone(end, TZ, 'h:mm a')}
        </div>
        <div className="text-xs opacity-70">{fieldName} · {block.source === 'manual' ? 'Requested' : 'Practice'}</div>
      </div>
      {!isCancelled && (
        <form action={cancelOwnBlock}>
          <input type="hidden" name="id" value={block.id} />
          <button className="text-xs underline hover:no-underline">Cancel</button>
        </form>
      )}
    </li>
  );
}
```

Create `app/coach/_components/pending-request-row.tsx`:

```typescript
import { formatInTimeZone } from 'date-fns-tz';
import { withdrawSlotRequest } from '../_actions';

const TZ = 'America/New_York';

type Request = {
  id: string;
  start_at: string;
  end_at: string;
  field_id: string;
  admin_note: string | null;
};

export function PendingRequestRow({
  request,
  fieldName,
}: {
  request: Request;
  fieldName: string;
}) {
  const start = new Date(request.start_at);
  const end = new Date(request.end_at);
  return (
    <li className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
      <div>
        <div className="font-medium">
          {formatInTimeZone(start, TZ, 'EEE MMM d')} · {formatInTimeZone(start, TZ, 'h:mm a')}–{formatInTimeZone(end, TZ, 'h:mm a')}
        </div>
        <div className="text-xs opacity-70">{fieldName} · awaiting admin approval</div>
        {request.admin_note && <div className="mt-1 text-xs opacity-70">Your note: {request.admin_note}</div>}
      </div>
      <form action={withdrawSlotRequest}>
        <input type="hidden" name="id" value={request.id} />
        <button className="text-xs underline hover:no-underline">Withdraw</button>
      </form>
    </li>
  );
}
```

### Task 5.4: Coach page (rewrite)

Replace `app/coach/page.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ScheduleBlock } from '@/lib/types';
import type { OpenWindow } from '@/lib/requests/windows';
import { RequestForm } from './_components/request-form';
import { UpcomingBlockRow } from './_components/upcoming-block-row';
import { PendingRequestRow } from './_components/pending-request-row';

export default async function CoachPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, name, email, team_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!coach) redirect('/login');

  const { data: team } = coach.team_id
    ? await admin.from('teams').select('name').eq('id', coach.team_id).maybeSingle()
    : { data: null };

  const fourWeeksOut = new Date();
  fourWeeksOut.setUTCDate(fourWeeksOut.getUTCDate() + 28);

  const teamIdFilter = coach.team_id ?? '00000000-0000-0000-0000-000000000000';

  const [blocksRes, fieldsRes, windowsRes, requestsRes] = await Promise.all([
    admin
      .from('schedule_blocks')
      .select('*')
      .eq('team_id', teamIdFilter)
      .gte('start_at', new Date().toISOString())
      .lte('start_at', fourWeeksOut.toISOString())
      .order('start_at')
      .limit(100),
    admin.from('fields').select('id, name').order('name'),
    admin
      .from('open_windows')
      .select('id, field_id, day_of_week, start_time, end_time')
      .eq('org_id', coach.org_id),
    admin
      .from('slot_requests')
      .select('id, start_at, end_at, field_id, admin_note, status')
      .eq('requester_coach_id', coach.id)
      .eq('status', 'pending')
      .order('start_at'),
  ]);

  const blocks = (blocksRes.data ?? []) as ScheduleBlock[];
  const fields = fieldsRes.data ?? [];
  const fieldNameById = new Map(fields.map((f) => [f.id, f.name]));
  const windows = (windowsRes.data ?? []) as OpenWindow[];
  const requests = requestsRes.data ?? [];

  async function signOut() {
    'use server';
    const s = await createClient();
    await s.auth.signOut();
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="flex items-center justify-between border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <div>
          <div className="text-xs uppercase tracking-wide text-tj-gold">{team?.name ?? 'No team assigned'}</div>
          <h1 className="text-lg font-semibold">Welcome, {coach.name}</h1>
        </div>
        <form action={signOut}>
          <button className="text-sm text-tj-gold-soft hover:text-tj-gold underline underline-offset-4">Sign out</button>
        </form>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-tj-black/60">Your upcoming blocks</h2>
          {blocks.length === 0 ? (
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No upcoming practices. Request a slot below.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {blocks.map((b) => (
                <UpcomingBlockRow key={b.id} block={b} fieldName={fieldNameById.get(b.field_id) ?? ''} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-tj-black/60">Request a slot</h2>
          <div className="rounded-lg border border-tj-black/10 bg-white p-4">
            <RequestForm fields={fields} windows={windows} />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-tj-black/60">Your pending requests</h2>
          {requests.length === 0 ? (
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No pending requests.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {requests.map((r) => (
                <PendingRequestRow key={r.id} request={r} fieldName={fieldNameById.get(r.field_id) ?? ''} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
```

### Task 5.5: Coach error boundary

Create `app/coach/error.tsx`:

```typescript
'use client';

export default function CoachError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-tj-cream p-6 text-tj-black">
      <div className="mx-auto max-w-lg rounded-lg border border-override-red bg-white p-6">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm opacity-70">{error.message}</p>
        <button onClick={reset} className="mt-4 rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80">
          Try again
        </button>
      </div>
    </div>
  );
}
```

### Task 5.6: Commit Phase 5

```bash
git add app/coach/
git commit -m "feat(coach): portal with upcoming blocks, slot request form, pending requests"
git push
```

---

## Phase 6 — Admin approval queue

### Task 6.1: Add approve/deny server actions

Append to `app/admin/_actions.ts`:

```typescript
import {
  notifyRequestApproved,
  notifyRequestDenied,
} from '@/lib/notifications/enqueue';

type SlotRequestRow = {
  id: string;
  org_id: string;
  requesting_team_id: string;
  requester_coach_id: string;
  requested_block_id: string | null;
  field_id: string;
  start_at: string;
  end_at: string;
  admin_note: string | null;
  status: string;
};

async function loadRequest(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin
    .from('slot_requests')
    .select('id, org_id, requesting_team_id, requester_coach_id, field_id, start_at, end_at, admin_note, status, requested_block_id')
    .eq('id', id)
    .maybeSingle();
  return data as SlotRequestRow | null;
}

export async function approveSlotRequest(formData: FormData) {
  const { adminClient } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const adminNote = String(formData.get('admin_note') ?? '').trim() || null;
  if (!id) throw new Error('Missing request id');

  const request = await loadRequest(adminClient, id);
  if (!request) throw new Error('Request not found');
  if (request.status !== 'pending') throw new Error('Request is not pending');

  // Create the confirmed block.
  const { data: block, error: insErr } = await adminClient
    .from('schedule_blocks')
    .insert({
      org_id: request.org_id,
      field_id: request.field_id,
      team_id: request.requesting_team_id,
      source: 'manual',
      status: 'confirmed',
      start_at: request.start_at,
      end_at: request.end_at,
      notes: request.admin_note,
    })
    .select('id')
    .single();
  if (insErr || !block) throw new Error(`Block insert failed: ${insErr?.message ?? 'unknown'}`);

  await adminClient
    .from('slot_requests')
    .update({
      status: 'approved',
      admin_note: adminNote ?? request.admin_note,
      resolved_at: new Date().toISOString(),
      requested_block_id: block.id,
    })
    .eq('id', id);

  // Auto-deny overlapping pending requests on the same field.
  const { data: pending } = await adminClient
    .from('slot_requests')
    .select('id, org_id, requester_coach_id, field_id, start_at, end_at, admin_note, requesting_team_id, status, requested_block_id')
    .eq('field_id', request.field_id)
    .eq('status', 'pending');

  const startMs = new Date(request.start_at).getTime();
  const endMs = new Date(request.end_at).getTime();
  const superseded = (pending ?? []).filter((p) => {
    if (p.id === id) return false;
    const ps = new Date(p.start_at).getTime();
    const pe = new Date(p.end_at).getTime();
    return ps < endMs && pe > startMs;
  });

  for (const s of superseded) {
    await adminClient
      .from('slot_requests')
      .update({
        status: 'denied',
        admin_note: 'superseded',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', s.id);
  }

  // Notifications (fire-and-log; don't block on failures).
  const { data: requester } = await adminClient
    .from('coaches')
    .select('id, name, email, team_id')
    .eq('id', request.requester_coach_id)
    .maybeSingle();
  const { data: field } = await adminClient
    .from('fields')
    .select('name')
    .eq('id', request.field_id)
    .maybeSingle();

  if (requester?.email && field) {
    await notifyRequestApproved(
      adminClient,
      request.org_id,
      { ...request, admin_note: adminNote },
      { id: requester.id, name: requester.name, email: requester.email, team_id: requester.team_id },
      field.name,
      block.id
    );
  }

  for (const s of superseded) {
    const { data: sCoach } = await adminClient
      .from('coaches')
      .select('id, name, email, team_id')
      .eq('id', s.requester_coach_id)
      .maybeSingle();
    if (sCoach?.email && field) {
      await notifyRequestDenied(
        adminClient,
        request.org_id,
        {
          id: s.id,
          start_at: s.start_at,
          end_at: s.end_at,
          field_id: s.field_id,
          requester_coach_id: s.requester_coach_id,
          admin_note: 'superseded',
        },
        { id: sCoach.id, name: sCoach.name, email: sCoach.email, team_id: sCoach.team_id },
        field.name,
        true
      );
    }
  }

  revalidatePath('/admin/requests');
  revalidatePath('/admin');
  revalidatePath('/coach');
}

export async function denySlotRequest(formData: FormData) {
  const { adminClient } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const adminNote = String(formData.get('admin_note') ?? '').trim() || null;
  if (!id) throw new Error('Missing request id');

  const request = await loadRequest(adminClient, id);
  if (!request) throw new Error('Request not found');
  if (request.status !== 'pending') throw new Error('Request is not pending');

  await adminClient
    .from('slot_requests')
    .update({
      status: 'denied',
      admin_note: adminNote,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id);

  const { data: requester } = await adminClient
    .from('coaches')
    .select('id, name, email, team_id')
    .eq('id', request.requester_coach_id)
    .maybeSingle();
  const { data: field } = await adminClient
    .from('fields')
    .select('name')
    .eq('id', request.field_id)
    .maybeSingle();

  if (requester?.email && field) {
    await notifyRequestDenied(
      adminClient,
      request.org_id,
      { ...request, admin_note: adminNote },
      { id: requester.id, name: requester.name, email: requester.email, team_id: requester.team_id },
      field.name
    );
  }

  revalidatePath('/admin/requests');
  revalidatePath('/admin');
  revalidatePath('/coach');
}
```

### Task 6.2: Requests page

Create `app/admin/requests/page.tsx`:

```typescript
import { formatDistanceToNow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveSlotRequest, denySlotRequest } from '../_actions';

const TZ = 'America/New_York';

export default async function RequestsPage() {
  const admin = createAdminClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [pendingRes, recentRes, coachesRes, fieldsRes, teamsRes] = await Promise.all([
    admin
      .from('slot_requests')
      .select('id, requesting_team_id, requester_coach_id, field_id, start_at, end_at, admin_note, status, created_at')
      .eq('status', 'pending')
      .order('created_at'),
    admin
      .from('slot_requests')
      .select('id, requesting_team_id, requester_coach_id, field_id, start_at, end_at, admin_note, status, resolved_at')
      .in('status', ['approved', 'denied'])
      .gte('resolved_at', sevenDaysAgo.toISOString())
      .order('resolved_at', { ascending: false })
      .limit(20),
    admin.from('coaches').select('id, name'),
    admin.from('fields').select('id, name, short_name'),
    admin.from('teams').select('id, name'),
  ]);

  const coachNameById = new Map((coachesRes.data ?? []).map((c) => [c.id, c.name]));
  const fieldNameById = new Map((fieldsRes.data ?? []).map((f) => [f.id, f.short_name ?? f.name]));
  const teamNameById = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]));

  const pending = pendingRes.data ?? [];
  const recent = recentRes.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Slot requests</h2>
        <p className="text-sm opacity-70">
          Pending requests show here. Approving creates a confirmed block and auto-declines any overlaps.
        </p>
      </header>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <h3 className="border-b border-tj-black/10 bg-tj-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">
          Pending ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="p-4 text-sm text-tj-black/50">No pending requests.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
              <tr>
                <th className="p-2">Submitted</th>
                <th className="p-2">Coach</th>
                <th className="p-2">Team</th>
                <th className="p-2">Field</th>
                <th className="p-2">When</th>
                <th className="p-2">Note</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} className="border-t border-tj-black/5 align-top">
                  <td className="p-2 whitespace-nowrap text-xs opacity-70">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                  <td className="p-2">{coachNameById.get(r.requester_coach_id) ?? '—'}</td>
                  <td className="p-2">{teamNameById.get(r.requesting_team_id) ?? '—'}</td>
                  <td className="p-2">{fieldNameById.get(r.field_id) ?? '—'}</td>
                  <td className="p-2 whitespace-nowrap">
                    {formatInTimeZone(new Date(r.start_at), TZ, 'EEE MMM d')}
                    <br />
                    <span className="text-xs opacity-70">
                      {formatInTimeZone(new Date(r.start_at), TZ, 'h:mm a')}–
                      {formatInTimeZone(new Date(r.end_at), TZ, 'h:mm a')}
                    </span>
                  </td>
                  <td className="p-2 text-xs">{r.admin_note ?? '—'}</td>
                  <td className="p-2">
                    <div className="flex justify-end gap-2">
                      <form action={approveSlotRequest}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="rounded bg-tj-gold px-2 py-1 text-xs font-medium text-tj-black hover:bg-tj-gold-soft">
                          Approve
                        </button>
                      </form>
                      <form action={denySlotRequest} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input
                          type="text"
                          name="admin_note"
                          placeholder="Reason (optional)"
                          className="rounded border border-tj-black/20 px-1 py-0.5 text-xs"
                        />
                        <button className="rounded border border-tj-black/20 px-2 py-1 text-xs hover:bg-tj-cream">
                          Deny
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <h3 className="border-b border-tj-black/10 bg-tj-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">
          Recently decided (last 7 days)
        </h3>
        {recent.length === 0 ? (
          <p className="p-4 text-sm text-tj-black/50">No recent decisions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
              <tr>
                <th className="p-2">Resolved</th>
                <th className="p-2">Status</th>
                <th className="p-2">Coach</th>
                <th className="p-2">Field</th>
                <th className="p-2">When</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-tj-black/5">
                  <td className="p-2 text-xs opacity-70">
                    {r.resolved_at ? formatDistanceToNow(new Date(r.resolved_at), { addSuffix: true }) : '—'}
                  </td>
                  <td className="p-2">
                    <span className={r.status === 'approved' ? 'rounded bg-tj-gold px-2 py-0.5 text-xs text-tj-black' : 'rounded bg-tj-black px-2 py-0.5 text-xs text-tj-cream'}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-2">{coachNameById.get(r.requester_coach_id) ?? '—'}</td>
                  <td className="p-2">{fieldNameById.get(r.field_id) ?? '—'}</td>
                  <td className="p-2 whitespace-nowrap text-xs">
                    {formatInTimeZone(new Date(r.start_at), TZ, 'MMM d, h:mm a')}–
                    {formatInTimeZone(new Date(r.end_at), TZ, 'h:mm a')}
                  </td>
                  <td className="p-2 text-xs">{r.admin_note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

### Task 6.3: Commit Phase 6

```bash
git add app/admin/
git commit -m "feat(admin): slot requests queue + approve/deny actions + email notifications"
git push
```

---

## Phase 7 — Nav badge for pending count

### Task 7.1: Update AdminNav to accept count + render badge

Replace `app/admin/_components/admin-nav.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/coaches', label: 'Coaches' },
  { href: '/admin/fields', label: 'Fields' },
  { href: '/admin/requests', label: 'Requests' },
];

export function AdminNav({ pendingRequests = 0 }: { pendingRequests?: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 border-b border-tj-black/10 bg-white px-6 py-2 text-sm">
      {LINKS.map((l) => {
        const isActive =
          l.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(l.href);
        const showBadge = l.href === '/admin/requests' && pendingRequests > 0;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              isActive
                ? 'underline underline-offset-4 decoration-tj-gold decoration-2'
                : 'text-tj-black/70 hover:text-tj-black'
            }
          >
            {l.label}
            {showBadge && (
              <span className="ml-1 rounded-full bg-tj-gold px-1.5 py-0.5 text-xs font-medium text-tj-black">
                {pendingRequests}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
```

### Task 7.2: Fetch count in admin layout

Modify `app/admin/layout.tsx`:

```typescript
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { AdminNav } from './_components/admin-nav';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const { count } = await admin
    .from('slot_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  async function signOut() {
    'use server';
    const s = await createClient();
    await s.auth.signOut();
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="flex items-center justify-between border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <h1 className="text-lg font-semibold">
          <span className="text-tj-gold">PYL</span> Field Manager — TJYBB
        </h1>
        <form action={signOut}>
          <button className="text-sm text-tj-gold-soft hover:text-tj-gold underline underline-offset-4">
            Sign out
          </button>
        </form>
      </header>
      <AdminNav pendingRequests={count ?? 0} />
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
```

### Task 7.3: Type-check + build + commit

```bash
npx --yes tsc --noEmit
npm run build
git add app/admin/
git commit -m "feat(admin): pending-request count badge on Requests nav link"
git push
```

---

## Phase 8 — Add Vercel env var + deploy

### Task 8.1: Push RESEND_API_KEY to Vercel

```bash
node --env-file=.env.local -e "process.stdout.write(process.env.RESEND_API_KEY)" | npx vercel@latest env add RESEND_API_KEY production
```

### Task 8.2: Deploy

```bash
npx vercel@latest --prod --yes
```

### Task 8.3: Smoke test

```bash
curl -sI https://fields.poweryourleague.com/coach | head -3
```
Expected: `307` (redirect to /login since not authenticated).

---

## Phase 9 — Local QA (Meesh-assisted)

Run through these manually with dev server + prod:

1. Log in as admin → `/admin/requests` shows "No pending requests" and nav shows "Requests" (no badge).
2. In Supabase Dashboard, set one of the test coaches' `auth_user_id` to null if they've logged in before, OR add a fresh coach via `/admin/coaches/new`. Log out and log in as that coach.
3. Coach lands on `/coach` showing their team's upcoming Mon practice (the travel_recurring block) and an empty request form.
4. Fill out: Field=885 Back, Date=next Saturday, Duration=2h, Start=2:00pm → Request slot.
5. See it appear in "Your pending requests".
6. Check the admin email inbox for the "New slot request" notification.
7. Log back in as admin → `/admin/requests` shows the request with badge `Requests (1)` in nav.
8. Click "Approve" → request moves to Recently decided; confirmed block appears in the coach's upcoming list; coach gets "Your slot is confirmed" email.
9. Submit another overlapping request from the same coach → validator rejects with "you already have a pending request that overlaps" (after withdrawing, try again).
10. Create two coaches, each submitting overlapping pending requests; approve one → the other is auto-denied; both coaches get emails (approve + superseded).
11. Cancel a future travel_recurring block from coach view → it shows cancelled on both `/coach` and `/admin`.

If anything fails: fix, commit, redeploy.

---

## Phase 10 — Session handoff

### Task 10.1: Write handoff doc

Create `docs/sessions/SESSION_4_coach_portal.md` using the Session 3 template structure. Fill in:
- What shipped (Units 1–6)
- Bugs caught during implementation
- Manual steps Meesh must do (apply migration, set RESEND_API_KEY in Vercel, verify Resend is working)
- Session 5 preview (override flow + SMS via Twilio)

### Task 10.2: Commit + close

```bash
git add docs/sessions/
git commit -m "docs(session-4): handoff — coach portal + slot request flow + emails"
git push
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Unit 1 migration | 1.1, 1.3 |
| Unit 1 seed update | 1.2 |
| Unit 2 windowsForDate + fitsInWindow | 2.1, 2.2 |
| Unit 3 coach portal sections | 5.4 |
| Unit 3 upcoming blocks with cancel | 5.3, 5.1 (cancelOwnBlock) |
| Unit 3 request form | 5.2 |
| Unit 3 pending requests + withdraw | 5.3, 5.1 (withdrawSlotRequest) |
| Unit 4 admin requests queue | 6.2 |
| Unit 4 approve / deny / superseded | 6.1 |
| Unit 5 Resend email sender | 4.2 |
| Unit 5 notification enqueue + DB audit | 4.3 |
| Unit 5 approve/deny/supersede notifications | 4.3, 6.1 |
| Unit 6 admin nav with badge | 7.1, 7.2 |
| Email RESEND_API_KEY in Vercel | 8.1 |
| Deploy | 8.2 |
| Handoff doc | 10.1 |

No gaps.

**Placeholder scan:** no "TODO", "TBD", or "similar to" references. Each task has full code.

**Type consistency:**

- `OpenWindow` used consistently in `windows.ts`, `validate.ts`, and the coach form via prop passing
- `SlotRequestRow` type in admin actions matches the columns selected in `loadRequest`
- `Coach` and `Request` shapes in `notifications/enqueue.ts` match what callers pass
- All server actions accept `FormData` and use `String(formData.get(...))` consistently
- `requireAdmin()` and `requireCoach()` both return `{ adminClient, coach }` with compatible shapes
