# Session 2 — Calendar + Travel Materialization + Block Detail (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the bare-bones Session 1 admin page into a usable field-scheduling dashboard with a week calendar grid, a travel-slot materialization job, and an editable block detail drawer. Styling uses TJYBB's black-and-gold palette.

**Architecture:** All data still flows through the existing Supabase schema — no migrations required. Travel materialization is a pure function + a new `/api/sync/travel-slots` route triggered by GitHub Actions and an admin button. Calendar UI is a server-rendered grid with URL-param navigation (`?week=`) and URL-param drawer (`?block=`) so most of it stays in React Server Components; only week navigation and the drawer save form need client interaction. Block edits use a server action.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript strict, Tailwind v4 (CSS vars via `@theme`), `@supabase/ssr` + `@supabase/supabase-js`, `date-fns` + `date-fns-tz`, `vitest` for materialization unit tests.

---

## Preconditions

- [x] Session 1 is shipped and deployed
- [x] Session 2 design approved at `docs/superpowers/specs/2026-04-20-session-2-calendar-and-materialization-design.md`
- [x] Brand decision: TJ black + gold
- [x] CRON_SECRET set in Vercel env + GitHub repo secrets
- [x] GitHub Actions hourly workflow exists

---

## File structure at end of session

```
app/
  globals.css                                   (modify — add @theme TJ tokens)
  admin/
    layout.tsx                                  (restyle with TJ palette)
    page.tsx                                    (major rewrite)
    _actions.ts                                 (new — server action for block update)
    _components/
      week-nav.tsx                              (new — client)
      week-grid.tsx                             (new — wrapper for both field grids)
      field-grid.tsx                            (new — one field's week grid)
      block-card.tsx                            (new — single positioned block)
      upcoming-list.tsx                         (new)
      open-slots-list.tsx                       (new)
      day-list.tsx                              (new — mobile fallback)
      block-drawer.tsx                          (new — server component)
      sync-buttons.tsx                          (new)
  api/sync/travel-slots/route.ts                (new)

lib/
  travel/
    materialize.ts                              (new — pure function)
    materialize.test.ts                         (new)
    ingest.ts                                   (new — upsert logic)
  calendar/
    week.ts                                     (new — week math helpers)
    week.test.ts                                (new)

.github/workflows/
  hourly-sync.yml                               (rename from sync-sports-connect.yml; add travel step)

docs/sessions/
  SESSION_2_calendar.md                         (new — session brief + handoff)
```

---

## Phase 1 — TJ palette + Session 1 restyle

### Task 1.1: Add TJ palette tokens

Modify `app/globals.css`:

- [ ] **Step 1:** Read existing `globals.css`, then write the new version below. Tailwind v4 uses `@theme` to declare design tokens.

```css
@import "tailwindcss";

@theme {
  --color-tj-black: #0a0a0a;
  --color-tj-gold: #c5a34a;
  --color-tj-gold-soft: #e6d08a;
  --color-tj-cream: #fbf7ee;
  --color-rec-blue: #3b6ea8;
  --color-override-red: #b84545;
  --color-manual-slate: #4a5568;
  --color-open-gray: #9ca3af;
}

:root {
  --background: var(--color-tj-cream);
  --foreground: var(--color-tj-black);
}

html,
body {
  background: var(--background);
  color: var(--foreground);
}
```

- [ ] **Step 2:** Build check.

```
npm run build
```
Expected: compiled successfully, no Tailwind errors.

- [ ] **Step 3:** Commit.

```
git add app/globals.css
git commit -m "feat(style): add TJ black-and-gold palette tokens via Tailwind v4 @theme"
git push
```

### Task 1.2: Restyle admin layout header

Replace `app/admin/layout.tsx`:

- [ ] **Step 1:** Write:

```typescript
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2:** Commit.

```
git add app/admin/layout.tsx
git commit -m "feat(style): restyle /admin header with TJ palette"
git push
```

---

## Phase 2 — Travel materialization (TDD)

### Task 2.1: Extend shared types

Modify `lib/types.ts`. Append:

```typescript
export type TravelRecurringSlot = {
  id: string;
  team_id: string;
  field_id: string;
  day_of_week: number; // 0=Sun … 6=Sat
  start_time: string;  // "HH:MM:SS"
  end_time: string;
  effective_from: string; // "YYYY-MM-DD"
  effective_to: string | null;
};

export type MaterializedBlock = {
  org_id: string;
  team_id: string;
  field_id: string;
  start_at: Date;
  end_at: Date;
  source_uid: string;
};
```

- [ ] **Step 1:** Append the two types at the bottom of the file.
- [ ] **Step 2:** Type-check: `npx --yes tsc --noEmit` — no output.

### Task 2.2: Write failing materialize tests

Create `lib/travel/materialize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { materializeSlot } from './materialize';
import type { TravelRecurringSlot } from '@/lib/types';

const ORG_ID = 'org-1';
const slot: TravelRecurringSlot = {
  id: 'slot-1',
  team_id: 'team-1',
  field_id: 'field-1',
  day_of_week: 1,
  start_time: '20:00:00',
  end_time: '22:00:00',
  effective_from: '2026-01-01',
  effective_to: null,
};

describe('materializeSlot', () => {
  it('produces one block per matching weekday in the window', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-05-04T00:00:00Z')
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source_uid).toBe('travel:slot-1:2026-04-20');
    expect(blocks[1].source_uid).toBe('travel:slot-1:2026-04-27');
  });

  it('converts ET wall-clock to UTC (EDT = UTC-4)', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-04-27T00:00:00Z')
    );
    expect(blocks[0].start_at.toISOString()).toBe('2026-04-21T00:00:00.000Z');
    expect(blocks[0].end_at.toISOString()).toBe('2026-04-21T02:00:00.000Z');
  });

  it('handles DST spring-forward', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-03-09T00:00:00Z'),
      new Date('2026-03-16T00:00:00Z')
    );
    expect(blocks[0].start_at.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('handles DST fall-back', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-11-02T00:00:00Z'),
      new Date('2026-11-09T00:00:00Z')
    );
    expect(blocks[0].start_at.toISOString()).toBe('2026-11-03T01:00:00.000Z');
  });

  it('respects effective_from', () => {
    const future = { ...slot, effective_from: '2026-05-01' };
    const blocks = materializeSlot(
      future,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-05-11T00:00:00Z')
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source_uid).toBe('travel:slot-1:2026-05-04');
  });

  it('respects effective_to (inclusive)', () => {
    const bounded = { ...slot, effective_to: '2026-04-21' };
    const blocks = materializeSlot(
      bounded,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-05-11T00:00:00Z')
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source_uid).toBe('travel:slot-1:2026-04-20');
  });
});
```

- [ ] **Step 1:** Create file with above content.
- [ ] **Step 2:** Run: `npm test` — expected fail with "Cannot find module './materialize'".

### Task 2.3: Implement materializeSlot

Create `lib/travel/materialize.ts`:

```typescript
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import { addDays, format, parseISO } from 'date-fns';
import type { TravelRecurringSlot, MaterializedBlock } from '@/lib/types';

const TZ = 'America/New_York';

export function materializeSlot(
  slot: TravelRecurringSlot,
  orgId: string,
  windowStart: Date,
  windowEndExclusive: Date
): MaterializedBlock[] {
  const effectiveFrom = parseISO(slot.effective_from);
  const effectiveTo = slot.effective_to ? parseISO(slot.effective_to) : null;

  const blocks: MaterializedBlock[] = [];

  let cursorEt = utcToZonedTime(windowStart, TZ);
  cursorEt = new Date(cursorEt.getFullYear(), cursorEt.getMonth(), cursorEt.getDate());

  const endEt = utcToZonedTime(windowEndExclusive, TZ);

  while (cursorEt < endEt) {
    const dow = cursorEt.getDay();
    const isoDate = format(cursorEt, 'yyyy-MM-dd');
    const dateOnly = parseISO(isoDate);

    const beforeEffective = dateOnly < effectiveFrom;
    const afterEffective = effectiveTo !== null && dateOnly > effectiveTo;

    if (dow === slot.day_of_week && !beforeEffective && !afterEffective) {
      const start_at = zonedTimeToUtc(`${isoDate}T${slot.start_time}`, TZ);
      const end_at = zonedTimeToUtc(`${isoDate}T${slot.end_time}`, TZ);
      blocks.push({
        org_id: orgId,
        team_id: slot.team_id,
        field_id: slot.field_id,
        start_at,
        end_at,
        source_uid: `travel:${slot.id}:${isoDate}`,
      });
    }

    cursorEt = addDays(cursorEt, 1);
  }

  return blocks;
}
```

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Run: `npm test` — all 6 tests pass.
- [ ] **Step 3:** Commit.

```
git add lib/travel/materialize.ts lib/travel/materialize.test.ts lib/types.ts
git commit -m "feat(travel): materializeSlot with DST + effective-range tests"
git push
```

### Task 2.4: Travel ingest (DB upsert)

Create `lib/travel/ingest.ts`:

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays } from 'date-fns';
import type { TravelRecurringSlot, MaterializedBlock } from '@/lib/types';
import { materializeSlot } from './materialize';

type IngestCounts = {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
  errors: { source_uid: string; message: string }[];
};

export async function ingestTravelSlots(
  supabase: SupabaseClient,
  orgId: string,
  windowDays: number = 56
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    seen: 0, inserted: 0, updated: 0, unchanged: 0, deleted: 0, errors: [],
  };

  const windowStart = new Date();
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd = addDays(windowStart, windowDays);

  const { data: slotRows, error: slotErr } = await supabase
    .from('travel_recurring_slots')
    .select(`id, team_id, field_id, day_of_week, start_time, end_time, effective_from, effective_to, teams!inner(org_id)`)
    .eq('teams.org_id', orgId);
  if (slotErr) throw new Error(`Load slots failed: ${slotErr.message}`);
  const slots = (slotRows ?? []) as unknown as TravelRecurringSlot[];

  const desired: MaterializedBlock[] = [];
  for (const slot of slots) {
    desired.push(...materializeSlot(slot, orgId, windowStart, windowEnd));
  }
  counts.seen = desired.length;

  const { data: existing, error: exErr } = await supabase
    .from('schedule_blocks')
    .select('id, source_uid, start_at, end_at, team_id, field_id')
    .eq('source', 'travel_recurring')
    .eq('org_id', orgId)
    .gte('start_at', windowStart.toISOString())
    .lt('start_at', windowEnd.toISOString());
  if (exErr) throw new Error(`Load existing failed: ${exErr.message}`);

  const existingByUid = new Map((existing ?? []).map((r) => [r.source_uid as string, r]));
  const desiredUids = new Set(desired.map((d) => d.source_uid));

  for (const d of desired) {
    const payload = {
      org_id: d.org_id,
      team_id: d.team_id,
      field_id: d.field_id,
      start_at: d.start_at.toISOString(),
      end_at: d.end_at.toISOString(),
      source: 'travel_recurring' as const,
      source_uid: d.source_uid,
      status: 'confirmed' as const,
    };
    const prev = existingByUid.get(d.source_uid);
    if (!prev) {
      const { error } = await supabase.from('schedule_blocks').insert(payload);
      if (error) counts.errors.push({ source_uid: d.source_uid, message: error.message });
      else counts.inserted += 1;
    } else {
      const needsUpdate =
        prev.start_at !== payload.start_at ||
        prev.end_at !== payload.end_at ||
        prev.team_id !== payload.team_id ||
        prev.field_id !== payload.field_id;
      if (needsUpdate) {
        const { error } = await supabase
          .from('schedule_blocks')
          .update({
            start_at: payload.start_at,
            end_at: payload.end_at,
            team_id: payload.team_id,
            field_id: payload.field_id,
          })
          .eq('id', prev.id);
        if (error) counts.errors.push({ source_uid: d.source_uid, message: error.message });
        else counts.updated += 1;
      } else {
        counts.unchanged += 1;
      }
    }
  }

  const staleIds = (existing ?? [])
    .filter((r) => !desiredUids.has(r.source_uid as string))
    .map((r) => r.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from('schedule_blocks').delete().in('id', staleIds);
    if (error) counts.errors.push({ source_uid: '(bulk-delete)', message: error.message });
    else counts.deleted = staleIds.length;
  }

  return counts;
}
```

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Type-check: `npx --yes tsc --noEmit` — no output.
- [ ] **Step 3:** Commit.

```
git add lib/travel/ingest.ts
git commit -m "feat(travel): ingestTravelSlots — idempotent upsert + stale-row cleanup"
git push
```

### Task 2.5: Travel sync route

Create `app/api/sync/travel-slots/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ingestTravelSlots } from '@/lib/travel/ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id').eq('slug', 'tjybb').single();
  if (orgErr || !org) {
    return NextResponse.json({ error: `org lookup failed: ${orgErr?.message ?? 'not found'}` }, { status: 500 });
  }

  const { data: run, error: runErr } = await supabase
    .from('sync_runs').insert({ source: 'travel_recurring', status: 'running' }).select().single();
  if (runErr || !run) {
    return NextResponse.json({ error: `sync_runs insert failed: ${runErr?.message}` }, { status: 500 });
  }

  try {
    const counts = await ingestTravelSlots(supabase, org.id);
    const status = counts.errors.length === 0 ? 'success' : 'partial';
    await supabase.from('sync_runs').update({
      ended_at: new Date().toISOString(),
      events_seen: counts.seen,
      events_inserted: counts.inserted,
      events_updated: counts.updated,
      events_unchanged: counts.unchanged,
      errors: counts.errors.length ? counts.errors : null,
      status,
    }).eq('id', run.id);
    return NextResponse.json({ run_id: run.id, ...counts, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from('sync_runs').update({
      ended_at: new Date().toISOString(),
      errors: [{ source_uid: null, message }],
      status: 'failed',
    }).eq('id', run.id);
    return NextResponse.json({ error: message, run_id: run.id }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
```

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Commit.

```
git add app/api/sync/travel-slots/
git commit -m "feat(travel): POST /api/sync/travel-slots route with sync_runs audit"
git push
```

### Task 2.6: Extend GitHub Actions workflow

- [ ] **Step 1:** Rename the workflow file:

```
git mv .github/workflows/sync-sports-connect.yml .github/workflows/hourly-sync.yml
```

- [ ] **Step 2:** Write `.github/workflows/hourly-sync.yml`:

```yaml
name: Hourly sync (rec + travel)

on:
  schedule:
    - cron: "15 * * * *"
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Sync Sports Connect (rec)
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            https://fields.poweryourleague.com/api/sync/sports-connect
      - name: Sync travel recurring slots
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            https://fields.poweryourleague.com/api/sync/travel-slots
```

- [ ] **Step 3:** Commit.

```
git add .github/workflows/
git commit -m "ci: rename workflow; add travel-slots step to hourly sync"
git push
```

---

## Phase 3 — Calendar week helpers (TDD)

### Task 3.1: Failing week-math tests

Create `lib/calendar/week.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  currentWeek,
  parseWeekParam,
  nextWeek,
  prevWeek,
  formatWeekParam,
  weekLabel,
} from './week';

describe('parseWeekParam', () => {
  it('parses "2026-W17" to the ET Monday Apr 20', () => {
    const w = parseWeekParam('2026-W17');
    expect(w.start.toISOString()).toBe('2026-04-20T04:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2026-04-27T04:00:00.000Z');
    expect(w.param).toBe('2026-W17');
  });

  it('falls back to current week on missing/malformed', () => {
    const current = currentWeek();
    expect(parseWeekParam(undefined).param).toBe(current.param);
    expect(parseWeekParam('bananas').param).toBe(current.param);
  });
});

describe('nextWeek / prevWeek', () => {
  it('increments and decrements by 7 days', () => {
    const w = parseWeekParam('2026-W17');
    expect(nextWeek(w).param).toBe('2026-W18');
    expect(prevWeek(w).param).toBe('2026-W16');
  });
});

describe('weekLabel', () => {
  it('returns "Apr 20 – Apr 26, 2026"', () => {
    expect(weekLabel(parseWeekParam('2026-W17'))).toBe('Apr 20 – Apr 26, 2026');
  });
});

describe('formatWeekParam', () => {
  it('round-trips', () => {
    const w = parseWeekParam('2026-W17');
    expect(formatWeekParam(w.start)).toBe('2026-W17');
  });
});
```

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Run: `npm test` — expected fail (module not found).

### Task 3.2: Implement week helpers

Create `lib/calendar/week.ts`:

```typescript
import { addDays, getISOWeek, getISOWeekYear, format } from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';

const TZ = 'America/New_York';

export type WeekBounds = {
  start: Date;
  endExclusive: Date;
  param: string;
};

function mondayFor(d: Date): Date {
  const local = utcToZonedTime(d, TZ);
  const diff = (local.getDay() + 6) % 7;
  const mondayLocal = new Date(local);
  mondayLocal.setDate(local.getDate() - diff);
  mondayLocal.setHours(0, 0, 0, 0);
  const isoStr = format(mondayLocal, "yyyy-MM-dd'T'00:00:00");
  return zonedTimeToUtc(isoStr, TZ);
}

export function boundsForMonday(m: Date): WeekBounds {
  const etDate = utcToZonedTime(m, TZ);
  const isoWeek = getISOWeek(etDate);
  const isoYear = getISOWeekYear(etDate);
  const endExclusive = new Date(m);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 7);
  return {
    start: m,
    endExclusive,
    param: `${isoYear}-W${String(isoWeek).padStart(2, '0')}`,
  };
}

export function currentWeek(): WeekBounds {
  return boundsForMonday(mondayFor(new Date()));
}

export function parseWeekParam(param: string | undefined): WeekBounds {
  if (!param) return currentWeek();
  const m = /^(\d{4})-W(\d{2})$/.exec(param);
  if (!m) return currentWeek();
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4, 0, 0, 0));
  const jan4Monday = mondayFor(jan4);
  const targetMonday = new Date(jan4Monday);
  targetMonday.setUTCDate(targetMonday.getUTCDate() + (week - 1) * 7);
  return boundsForMonday(targetMonday);
}

export function formatWeekParam(mondayUtc: Date): string {
  return boundsForMonday(mondayUtc).param;
}

export function nextWeek(w: WeekBounds): WeekBounds {
  return boundsForMonday(addDays(w.start, 7));
}

export function prevWeek(w: WeekBounds): WeekBounds {
  return boundsForMonday(addDays(w.start, -7));
}

export function weekLabel(w: WeekBounds): string {
  const startEt = utcToZonedTime(w.start, TZ);
  const endEt = utcToZonedTime(addDays(w.start, 6), TZ);
  return `${format(startEt, 'MMM d')} – ${format(endEt, 'MMM d, yyyy')}`;
}
```

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Run: `npm test` — all tests pass.
- [ ] **Step 3:** Commit.

```
git add lib/calendar/
git commit -m "feat(calendar): week math helpers with ET anchoring"
git push
```

---

## Phase 4 — Calendar UI components

### Task 4.1: BlockCard (positioned block)

Create `app/admin/_components/block-card.tsx`:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

const SOURCE_BG: Record<string, string> = {
  sports_connect: 'bg-rec-blue text-white',
  travel_recurring: 'bg-tj-gold text-tj-black',
  override: 'bg-override-red text-white',
  manual: 'bg-manual-slate text-white',
  open_slot: 'bg-transparent text-tj-black border-2 border-dashed border-open-gray',
};

const STATUS_EXTRA: Record<string, string> = {
  confirmed: '',
  tentative: 'border-dashed border-2',
  cancelled: 'opacity-40 line-through',
  overridden: 'ring-2 ring-override-red',
  open: '',
};

function teamLabel(b: ScheduleBlock, teamName: string | null): string {
  if (b.source === 'open_slot') return 'Open slot';
  if (b.source === 'sports_connect') {
    if (b.away_team_raw && b.home_team_raw) return `${b.away_team_raw} @ ${b.home_team_raw}`;
    return b.raw_summary ?? 'Rec game';
  }
  return teamName ?? 'Block';
}

export function BlockCard({
  block, teamName, topPx, heightPx, weekParam,
}: {
  block: ScheduleBlock;
  teamName: string | null;
  topPx: number;
  heightPx: number;
  weekParam: string;
}) {
  const bg = SOURCE_BG[block.source] ?? 'bg-neutral-200 text-neutral-900';
  const status = STATUS_EXTRA[block.status] ?? '';
  const start = formatInTimeZone(new Date(block.start_at), TZ, 'h:mm a');
  const end = formatInTimeZone(new Date(block.end_at), TZ, 'h:mm a');
  const label = teamLabel(block, teamName);

  return (
    <Link
      href={`?week=${weekParam}&block=${block.id}`}
      scroll={false}
      className={`absolute left-0.5 right-0.5 rounded px-1.5 py-1 text-xs leading-tight shadow-sm hover:brightness-110 ${bg} ${status}`}
      style={{ top: topPx, height: heightPx }}
    >
      <div className="truncate font-medium">{label}</div>
      <div className="truncate opacity-80">{start} – {end}</div>
    </Link>
  );
}
```

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Commit (batch with next few components).

### Task 4.2: FieldGrid

Create `app/admin/_components/field-grid.tsx`:

```typescript
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';
import { BlockCard } from './block-card';

const TZ = 'America/New_York';
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const ROW_HEIGHT_PX = 32;
const HOURS_PER_DAY = DAY_END_HOUR - DAY_START_HOUR;

function dayColumn(weekStart: Date, dayIndex: number) {
  const start = new Date(weekStart);
  start.setUTCDate(start.getUTCDate() + dayIndex);
  return start;
}

function hoursOffsetInDay(blockStart: Date, dayStartUtc: Date): number {
  return (blockStart.getTime() - dayStartUtc.getTime()) / (1000 * 60 * 60);
}

export function FieldGrid({
  fieldId, fieldName, weekStart, weekParam, blocks, teamNameById,
}: {
  fieldId: string;
  fieldName: string;
  weekStart: Date;
  weekParam: string;
  blocks: ScheduleBlock[];
  teamNameById: Map<string, string>;
}) {
  const fieldBlocks = blocks.filter((b) => b.field_id === fieldId);
  const days = Array.from({ length: 7 }, (_, i) => dayColumn(weekStart, i));

  return (
    <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white shadow-sm">
      <h3 className="border-b border-tj-black/10 bg-tj-black px-4 py-2 text-sm font-semibold text-tj-cream">
        {fieldName}
      </h3>
      <div className="grid" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
        <div className="border-b border-r border-tj-black/10 bg-tj-cream" />
        {days.map((d) => (
          <div key={d.toISOString()} className="border-b border-r border-tj-black/10 bg-tj-cream px-2 py-1 text-center text-xs font-medium">
            <div>{formatInTimeZone(d, TZ, 'EEE')}</div>
            <div className="text-[10px] opacity-70">{formatInTimeZone(d, TZ, 'MMM d')}</div>
          </div>
        ))}

        <div>
          {Array.from({ length: HOURS_PER_DAY }).map((_, i) => (
            <div key={i} className="flex items-start justify-end border-r border-b border-tj-black/10 pr-1 pt-0.5 text-[10px] text-tj-black/50" style={{ height: ROW_HEIGHT_PX }}>
              {formatInTimeZone(new Date(Date.UTC(2026, 0, 1, DAY_START_HOUR + i, 0)), 'UTC', 'h a').toLowerCase()}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayStartUtc = new Date(day);
          const dayEndUtc = new Date(day);
          dayEndUtc.setUTCDate(dayEndUtc.getUTCDate() + 1);
          const dayBlocks = fieldBlocks.filter((b) => {
            const bs = new Date(b.start_at);
            return bs >= dayStartUtc && bs < dayEndUtc;
          });
          return (
            <div key={day.toISOString()} className="relative border-r border-b border-tj-black/10" style={{ height: HOURS_PER_DAY * ROW_HEIGHT_PX }}>
              {Array.from({ length: HOURS_PER_DAY - 1 }).map((_, i) => (
                <div key={i} className="pointer-events-none absolute left-0 right-0 border-t border-tj-black/5" style={{ top: (i + 1) * ROW_HEIGHT_PX }} />
              ))}
              {dayBlocks.map((b) => {
                const bs = new Date(b.start_at);
                const be = new Date(b.end_at);
                const offset = hoursOffsetInDay(bs, dayStartUtc) - DAY_START_HOUR;
                const durHours = (be.getTime() - bs.getTime()) / (1000 * 60 * 60);
                const topPx = Math.max(0, offset * ROW_HEIGHT_PX);
                const heightPx = Math.max(18, durHours * ROW_HEIGHT_PX);
                return (
                  <BlockCard key={b.id} block={b} teamName={b.team_id ? teamNameById.get(b.team_id) ?? null : null} topPx={topPx} heightPx={heightPx} weekParam={weekParam} />
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 1:** Create file.

### Task 4.3: WeekGrid wrapper

Create `app/admin/_components/week-grid.tsx`:

```typescript
import type { ScheduleBlock } from '@/lib/types';
import type { WeekBounds } from '@/lib/calendar/week';
import { FieldGrid } from './field-grid';

type Field = { id: string; name: string; short_name: string | null };
type Team = { id: string; name: string };

export function WeekGrid({
  week, fields, blocks, teams,
}: {
  week: WeekBounds;
  fields: Field[];
  blocks: ScheduleBlock[];
  teams: Team[];
}) {
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="hidden md:flex md:flex-col md:gap-4">
      {sorted.map((f) => (
        <FieldGrid
          key={f.id}
          fieldId={f.id}
          fieldName={f.name}
          weekStart={week.start}
          weekParam={week.param}
          blocks={blocks}
          teamNameById={teamNameById}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 1:** Create file.

### Task 4.4: WeekNav (client)

Create `app/admin/_components/week-nav.tsx`:

```typescript
'use client';

import Link from 'next/link';
import {
  currentWeek,
  nextWeek as nextOf,
  prevWeek as prevOf,
  weekLabel,
  type WeekBounds,
} from '@/lib/calendar/week';

export function WeekNav({ week }: { week: WeekBounds }) {
  const prev = prevOf(week);
  const next = nextOf(week);
  const today = currentWeek();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tj-black/10 bg-white px-3 py-2 text-sm">
      <Link href={`?week=${prev.param}`} scroll={false} className="rounded px-2 py-1 hover:bg-tj-cream" aria-label="Previous week">◀</Link>
      <div className="min-w-[180px] text-center font-medium">Week of {weekLabel(week)}</div>
      <Link href={`?week=${next.param}`} scroll={false} className="rounded px-2 py-1 hover:bg-tj-cream" aria-label="Next week">▶</Link>
      {week.param !== today.param && (
        <Link href={`?week=${today.param}`} scroll={false} className="ml-2 rounded bg-tj-gold px-3 py-1 text-tj-black hover:bg-tj-gold-soft">Today</Link>
      )}
    </div>
  );
}
```

- [ ] **Step 1:** Create file.

### Task 4.5: DayList (mobile fallback)

Create `app/admin/_components/day-list.tsx`:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';
import type { WeekBounds } from '@/lib/calendar/week';

const TZ = 'America/New_York';

type Field = { id: string; name: string; short_name: string | null };
type Team = { id: string; name: string };

function label(b: ScheduleBlock, teamName: string | null): string {
  if (b.source === 'open_slot') return 'Open slot';
  if (b.source === 'sports_connect' && b.away_team_raw && b.home_team_raw) {
    return `${b.away_team_raw} @ ${b.home_team_raw}`;
  }
  return teamName ?? b.raw_summary ?? 'Block';
}

export function DayList({
  week, fields, blocks, teams, day,
}: {
  week: WeekBounds;
  fields: Field[];
  blocks: ScheduleBlock[];
  teams: Team[];
  day: number;
}) {
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const fieldNameById = new Map(fields.map((f) => [f.id, f.short_name ?? f.name]));

  const dayStart = new Date(week.start);
  dayStart.setUTCDate(dayStart.getUTCDate() + day);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const dayBlocks = blocks
    .filter((b) => {
      const bs = new Date(b.start_at);
      return bs >= dayStart && bs < dayEnd;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div className="flex flex-col gap-4 md:hidden">
      <div className="flex gap-1 overflow-x-auto">
        {Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(week.start);
          d.setUTCDate(d.getUTCDate() + i);
          const isActive = i === day;
          return (
            <Link key={i} href={`?week=${week.param}&day=${i}`} scroll={false} className={`shrink-0 rounded-full px-3 py-1 text-xs ${isActive ? 'bg-tj-black text-tj-cream' : 'bg-white text-tj-black border border-tj-black/10'}`}>
              {formatInTimeZone(d, TZ, 'EEE d')}
            </Link>
          );
        })}
      </div>
      {dayBlocks.length === 0 && (
        <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">No blocks this day.</p>
      )}
      <ul className="flex flex-col gap-2">
        {dayBlocks.map((b) => (
          <li key={b.id}>
            <Link href={`?week=${week.param}&day=${day}&block=${b.id}`} scroll={false} className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
              <div>
                <div className="font-medium">{label(b, b.team_id ? teamNameById.get(b.team_id) ?? null : null)}</div>
                <div className="text-xs opacity-70">
                  {fieldNameById.get(b.field_id) ?? b.field_id} · {formatInTimeZone(new Date(b.start_at), TZ, 'h:mm a')} – {formatInTimeZone(new Date(b.end_at), TZ, 'h:mm a')}
                </div>
              </div>
              <span className="text-xs uppercase tracking-wide opacity-60">{b.source.replace('_', ' ')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Commit all Phase 4 components together.

```
git add app/admin/_components/
git commit -m "feat(ui): BlockCard, FieldGrid, WeekGrid, WeekNav, DayList"
git push
```

---

## Phase 5 — Upcoming + open-slot lists

### Task 5.1: UpcomingList

Create `app/admin/_components/upcoming-list.tsx`:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

type Field = { id: string; name: string; short_name: string | null };
type Team = { id: string; name: string };

function label(b: ScheduleBlock, teamName: string | null): string {
  if (b.source === 'sports_connect' && b.away_team_raw && b.home_team_raw) {
    return `${b.away_team_raw} @ ${b.home_team_raw}`;
  }
  return teamName ?? b.raw_summary ?? 'Block';
}

export function UpcomingList({
  blocks, fields, teams, weekParam,
}: {
  blocks: ScheduleBlock[];
  fields: Field[];
  teams: Team[];
  weekParam: string;
}) {
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const fieldNameById = new Map(fields.map((f) => [f.id, f.short_name ?? f.name]));
  return (
    <section className="rounded-lg border border-tj-black/10 bg-white p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">Next 10 upcoming blocks</h3>
      {blocks.length === 0 ? (
        <p className="text-sm text-tj-black/50">Nothing scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {blocks.map((b) => (
            <li key={b.id}>
              <Link href={`?week=${weekParam}&block=${b.id}`} scroll={false} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-tj-cream">
                <span className="truncate">{label(b, b.team_id ? teamNameById.get(b.team_id) ?? null : null)}</span>
                <span className="ml-3 shrink-0 text-xs opacity-70">
                  {formatInTimeZone(new Date(b.start_at), TZ, 'EEE h:mm a')} · {fieldNameById.get(b.field_id) ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

### Task 5.2: OpenSlotsList

Create `app/admin/_components/open-slots-list.tsx`:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

type Field = { id: string; name: string; short_name: string | null };

export function OpenSlotsList({
  blocks, fields, weekParam,
}: {
  blocks: ScheduleBlock[];
  fields: Field[];
  weekParam: string;
}) {
  const fieldNameById = new Map(fields.map((f) => [f.id, f.short_name ?? f.name]));
  return (
    <section className="rounded-lg border border-tj-black/10 bg-white p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">Next 10 open slots</h3>
      {blocks.length === 0 ? (
        <p className="text-sm text-tj-black/50">No open slots available.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {blocks.map((b) => (
            <li key={b.id}>
              <Link href={`?week=${weekParam}&block=${b.id}`} scroll={false} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-tj-cream">
                <span className="truncate">Open slot</span>
                <span className="ml-3 shrink-0 text-xs opacity-70">
                  {formatInTimeZone(new Date(b.start_at), TZ, 'EEE MMM d, h:mm a')} · {fieldNameById.get(b.field_id) ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 1:** Create both files.
- [ ] **Step 2:** Commit.

```
git add app/admin/_components/upcoming-list.tsx app/admin/_components/open-slots-list.tsx
git commit -m "feat(ui): UpcomingList and OpenSlotsList"
git push
```

---

## Phase 6 — Block detail drawer + server action

### Task 6.1: Server action

Create `app/admin/_actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const EDITABLE_STATUSES = new Set(['confirmed', 'cancelled', 'tentative']);

export async function updateBlock(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const notesRaw = formData.get('notes');
  const notes = notesRaw === null ? null : String(notesRaw).slice(0, 500) || null;

  if (!id) throw new Error('Missing block id');
  if (!EDITABLE_STATUSES.has(status)) {
    throw new Error(`Status "${status}" is not editable here`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('schedule_blocks')
    .update({ status, notes })
    .eq('id', id);
  if (error) throw new Error(`Update failed: ${error.message}`);

  revalidatePath('/admin');
}
```

### Task 6.2: BlockDrawer

Create `app/admin/_components/block-drawer.tsx`:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/server';
import { updateBlock } from '../_actions';

const TZ = 'America/New_York';

const SOURCE_LABEL: Record<string, string> = {
  sports_connect: 'Rec (Sports Connect)',
  travel_recurring: 'Travel practice',
  manual: 'Manual',
  override: 'Rec override',
  open_slot: 'Open slot',
};

export async function BlockDrawer({ blockId, weekParam }: { blockId: string; weekParam: string }) {
  const supabase = await createClient();
  const { data: block } = await supabase
    .from('schedule_blocks').select('*').eq('id', blockId).maybeSingle();
  if (!block) return null;

  const { data: team } = block.team_id
    ? await supabase.from('teams').select('name').eq('id', block.team_id).maybeSingle()
    : { data: null };
  const { data: field } = await supabase.from('fields').select('name').eq('id', block.field_id).maybeSingle();

  const start = new Date(block.start_at);
  const end = new Date(block.end_at);
  const editable = ['confirmed', 'cancelled', 'tentative'].includes(block.status);

  return (
    <>
      <Link href={`?week=${weekParam}`} scroll={false} className="fixed inset-0 z-40 bg-black/40" aria-label="Close" />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-tj-black/10 bg-tj-black px-4 py-3 text-tj-cream">
          <div>
            <div className="text-xs uppercase tracking-wide text-tj-gold">{SOURCE_LABEL[block.source] ?? block.source}</div>
            <h2 className="text-sm font-semibold">{field?.name ?? block.field_id}</h2>
          </div>
          <Link href={`?week=${weekParam}`} scroll={false} className="text-tj-gold-soft hover:text-tj-gold" aria-label="Close">✕</Link>
        </header>
        <div className="flex flex-col gap-3 p-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-tj-black/50">Date</div>
            <div>{formatInTimeZone(start, TZ, 'EEEE, MMMM d, yyyy')}</div>
            <div className="opacity-70">{formatInTimeZone(start, TZ, 'h:mm a')} – {formatInTimeZone(end, TZ, 'h:mm a')}</div>
          </div>
          {team?.name && (
            <div>
              <div className="text-xs uppercase tracking-wide text-tj-black/50">Team</div>
              <div>{team.name}</div>
            </div>
          )}
          {(block.home_team_raw || block.away_team_raw) && (
            <div>
              <div className="text-xs uppercase tracking-wide text-tj-black/50">Matchup</div>
              <div>{block.away_team_raw} @ {block.home_team_raw}</div>
            </div>
          )}
          {editable ? (
            <form action={updateBlock} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={block.id} />
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-tj-black/50">Status</span>
                <select name="status" defaultValue={block.status} className="rounded border border-tj-black/20 px-2 py-1 text-sm">
                  <option value="confirmed">Confirmed</option>
                  <option value="tentative">Tentative</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-tj-black/50">Notes</span>
                <textarea name="notes" defaultValue={block.notes ?? ''} maxLength={500} rows={3} className="rounded border border-tj-black/20 px-2 py-1 text-sm" />
              </label>
              <div className="flex gap-2">
                <button type="submit" className="rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80">Save</button>
                <Link href={`?week=${weekParam}`} scroll={false} className="rounded border border-tj-black/20 px-3 py-1.5 text-sm hover:bg-tj-cream">Cancel</Link>
              </div>
            </form>
          ) : (
            <div>
              <div className="text-xs uppercase tracking-wide text-tj-black/50">Status</div>
              <div className="opacity-70">{block.status} <span className="text-xs">(not editable in this session)</span></div>
              {block.notes && <div className="mt-2 text-sm opacity-80">{block.notes}</div>}
            </div>
          )}
          <div className="text-xs opacity-50">Updated {formatInTimeZone(new Date(block.updated_at ?? block.created_at), TZ, 'MMM d, h:mm a')}</div>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 1:** Create both files.
- [ ] **Step 2:** Commit.

```
git add app/admin/_actions.ts app/admin/_components/block-drawer.tsx
git commit -m "feat(ui): BlockDrawer with status+notes edits via server action"
git push
```

---

## Phase 7 — Sync buttons + admin page rewrite

### Task 7.1: SyncButtons

Create `app/admin/_components/sync-buttons.tsx`:

```typescript
import { revalidatePath } from 'next/cache';

async function postSync(path: string) {
  'use server';
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET not set');
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001');
  await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    cache: 'no-store',
  });
  revalidatePath('/admin');
}

async function syncRec() { 'use server'; await postSync('/api/sync/sports-connect'); }
async function syncTravel() { 'use server'; await postSync('/api/sync/travel-slots'); }

export function SyncButtons() {
  return (
    <div className="flex gap-2">
      <form action={syncRec}>
        <button className="rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80">Sync rec</button>
      </form>
      <form action={syncTravel}>
        <button className="rounded bg-tj-gold px-3 py-1.5 text-sm text-tj-black hover:bg-tj-gold-soft">Sync travel</button>
      </form>
    </div>
  );
}
```

### Task 7.2: Rewrite admin page

Replace `app/admin/page.tsx`:

```typescript
import { createClient } from '@/lib/supabase/server';
import { formatInTimeZone } from 'date-fns-tz';
import { parseWeekParam } from '@/lib/calendar/week';
import { SyncButtons } from './_components/sync-buttons';
import { WeekNav } from './_components/week-nav';
import { WeekGrid } from './_components/week-grid';
import { DayList } from './_components/day-list';
import { UpcomingList } from './_components/upcoming-list';
import { OpenSlotsList } from './_components/open-slots-list';
import { BlockDrawer } from './_components/block-drawer';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; block?: string; day?: string }>;
}) {
  const params = await searchParams;
  const week = parseWeekParam(params.week);
  const dayIndex = params.day ? Math.min(6, Math.max(0, Number(params.day))) : 0;

  const supabase = await createClient();

  const [blocksWeekRes, fieldsRes, teamsRes, upcomingRes, openSlotsRes, runsRes] = await Promise.all([
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', week.start.toISOString())
      .lt('start_at', week.endExclusive.toISOString())
      .order('start_at').limit(500),
    supabase.from('fields').select('id, name, short_name'),
    supabase.from('teams').select('id, name'),
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', new Date().toISOString())
      .neq('source', 'open_slot')
      .order('start_at').limit(10),
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', new Date().toISOString())
      .eq('source', 'open_slot').eq('status', 'open')
      .order('start_at').limit(10),
    supabase.from('sync_runs').select('*')
      .order('started_at', { ascending: false }).limit(5),
  ]);

  const blocks = (blocksWeekRes.data ?? []) as ScheduleBlock[];
  const upcoming = (upcomingRes.data ?? []) as ScheduleBlock[];
  const openSlots = (openSlotsRes.data ?? []) as ScheduleBlock[];
  const fields = fieldsRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const runs = runsRes.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SyncButtons />
        <WeekNav week={week} />
      </div>

      <WeekGrid week={week} fields={fields} blocks={blocks} teams={teams} />
      <DayList week={week} fields={fields} blocks={blocks} teams={teams} day={dayIndex} />

      <div className="grid gap-4 md:grid-cols-2">
        <UpcomingList blocks={upcoming} fields={fields} teams={teams} weekParam={week.param} />
        <OpenSlotsList blocks={openSlots} fields={fields} weekParam={week.param} />
      </div>

      <section className="rounded-lg border border-tj-black/10 bg-white">
        <h2 className="border-b border-tj-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">Recent sync runs</h2>
        <table className="w-full text-sm">
          <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
            <tr>
              <th className="p-2">Started</th>
              <th className="p-2">Source</th>
              <th className="p-2">Status</th>
              <th className="p-2">Seen</th>
              <th className="p-2">Ins</th>
              <th className="p-2">Upd</th>
              <th className="p-2">Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-tj-black/5">
                <td className="p-2">{formatInTimeZone(new Date(r.started_at), TZ, 'MM-dd HH:mm')}</td>
                <td className="p-2">{r.source}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{r.events_seen}</td>
                <td className="p-2">{r.events_inserted}</td>
                <td className="p-2">{r.events_updated}</td>
                <td className="p-2">{r.errors ? JSON.stringify(r.errors).slice(0, 60) : '—'}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={7} className="p-3 text-tj-black/50">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {params.block && <BlockDrawer blockId={params.block} weekParam={week.param} />}
    </div>
  );
}
```

- [ ] **Step 1:** Create SyncButtons file and replace admin/page.tsx.
- [ ] **Step 2:** Type-check + build.

```
npx --yes tsc --noEmit && npm run build
```
Expected: no TS errors; build completes.

- [ ] **Step 3:** Commit.

```
git add app/admin/
git commit -m "feat(admin): new dashboard — week grid, lists, drawer, sync buttons"
git push
```

---

## Phase 8 — Local verification

### Task 8.1: Manual QA against the spec

- [ ] **Step 1:** Start dev server: `npm run dev`.
- [ ] **Step 2:** At `/admin`, verify week grid shows both fields stacked with color-coded blocks.
- [ ] **Step 3:** Click "Sync travel" → verify a new `travel_recurring` sync run row; refresh → 8 weeks of travel blocks appear.
- [ ] **Step 4:** Click a travel block → drawer opens; change status to "cancelled", save. Refresh → block shows strikethrough + 40% opacity.
- [ ] **Step 5:** Prev/next week buttons work; "Today" appears only when not on current week.
- [ ] **Step 6:** Resize to <768px → DayList appears; day tabs work.
- [ ] **Step 7:** Click "Sync travel" again → `unchanged` > 0, `inserted` = 0 (idempotent).

### Task 8.2: Fix issues found

Address iteratively with commits per fix. Add tests where a test would have caught the issue.

---

## Phase 9 — Deploy + close

### Task 9.1: Deploy

- [ ] **Step 1:** Deploy: `npx vercel@latest --prod --yes`.
- [ ] **Step 2:** Smoke: `curl -sI https://fields.poweryourleague.com/login | head -3` → `HTTP/2 200`.
- [ ] **Step 3:** Trigger GitHub Actions manually at `https://github.com/ronmitko-gif/pyl-field-manager/actions` → "Hourly sync (rec + travel)" → Run workflow → main → verify both steps succeed.

### Task 9.2: Session handoff

Create `docs/sessions/SESSION_2_calendar.md` using the SESSION_1 template structure. Fill in what works / pending / env vars / manual steps / next-session blockers. Commit.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Unit 1 materialization algorithm | 2.2, 2.3 |
| Unit 1 upsert + stale cleanup | 2.4 |
| Unit 1 route | 2.5 |
| Unit 1 GitHub Actions | 2.6 |
| Unit 1 admin button | 7.1 |
| Unit 2 week grid | 4.2, 4.3 |
| Unit 2 block colors + status | 4.1 |
| Unit 2 navigation | 4.4 |
| Unit 2 mobile fallback | 4.5 |
| Unit 3 drawer | 6.2 |
| Unit 3 status+notes edit | 6.1, 6.2 |
| Upcoming + open-slot lists | 5.1, 5.2 |
| TJ palette | 1.1, 1.2 |
| Admin page rewrite | 7.2 |
| Idempotent re-sync | 8.1 step 7 |

No gaps.

**Placeholder scan:** no TODOs, TBDs, or "similar to" references. Each task has full code.

**Type consistency:**

- `MaterializedBlock` used consistently across materialize / ingest
- `ScheduleBlock` imported from `@/lib/types` everywhere
- `WeekBounds` exported from `week.ts`, imported by nav / grid / day-list / admin page
- `teamNameById` / `fieldNameById` use `Map<string, string>` everywhere
- `materializeSlot(slot, orgId, start, end)` signature consistent between test and ingest
