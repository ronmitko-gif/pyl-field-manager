# Session 6 — Public View + Polish (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public read-only `/schedule` page, fix the global pointer-cursor miss on every button, polish login + coach empty states, and make the admin secondary nav scroll on narrow viewports.

**Architecture:** Public view reuses the existing `WeekGrid`/`BlockCard`/`DayList` via a new `readonly` prop — one source of truth for the grid. All other items are small edits in place.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4. No new deps.

---

## Preconditions

- [x] Sessions 1–5 shipped
- [x] Spec approved at `docs/superpowers/specs/2026-04-22-session-6-public-view-and-polish-design.md`
- [x] TJ palette tokens in `app/globals.css`

---

## File structure at end of session

```
app/
  globals.css                                   (modify — cursor-pointer rule)
  (auth)/login/page.tsx                         (modify — TJ header + public link)
  schedule/
    page.tsx                                    (new — public RSC)
  admin/
    _components/admin-nav.tsx                   (modify — overflow-x scroll)
    _components/block-card.tsx                  (modify — readonly prop)
    _components/field-grid.tsx                  (modify — pass readonly through)
    _components/week-grid.tsx                   (modify — readonly prop)
    _components/day-list.tsx                    (modify — readonly/clickable prop)
  coach/page.tsx                                (modify — empty states + null-team banner)

docs/sessions/
  SESSION_6_public_view_and_polish.md           (new — handoff)
```

No migrations, no new env vars, no new dependencies.

---

## Phase 1 — Global cursor fix

### Task 1.1: Append cursor rule to globals.css

Modify `app/globals.css`. Append at end:

```css
button:not(:disabled),
[role="button"] {
  cursor: pointer;
}
```

- [ ] **Step 1:** Append the rule. (Use Edit to add after the existing `html, body` block.)
- [ ] **Step 2:** Build check: `npm run build 2>&1 | tail -5` — expect clean.
- [ ] **Step 3:** Commit:

```bash
git add app/globals.css
git commit -m "style: global cursor-pointer rule for enabled buttons"
git push
```

---

## Phase 2 — Readonly props on grid components

The grid currently wraps every block in a `<Link>` that navigates to `?block=<id>` so the admin drawer can open. The public view doesn't have a drawer, so blocks need to render as plain `<div>`s there. Add a `readonly` flag that flows through the component tree.

### Task 2.1: `BlockCard` accepts `readonly`

Modify `app/admin/_components/block-card.tsx`. Current export signature changes from taking `weekParam` only to also accepting `readonly?: boolean`.

- [ ] **Step 1:** Replace the `BlockCard` export in full:

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
  block, teamName, topPx, heightPx, weekParam, readonly = false,
}: {
  block: ScheduleBlock;
  teamName: string | null;
  topPx: number;
  heightPx: number;
  weekParam: string;
  readonly?: boolean;
}) {
  const bg = SOURCE_BG[block.source] ?? 'bg-neutral-200 text-neutral-900';
  const status = STATUS_EXTRA[block.status] ?? '';
  const start = formatInTimeZone(new Date(block.start_at), TZ, 'h:mm a');
  const end = formatInTimeZone(new Date(block.end_at), TZ, 'h:mm a');
  const label = teamLabel(block, teamName);
  const base = `absolute left-0.5 right-0.5 overflow-hidden rounded px-1.5 py-1 text-xs leading-tight shadow-sm ${bg} ${status}`;

  const inner = (
    <>
      <div className="font-medium break-words">{label}</div>
      <div className="truncate opacity-80">{start} – {end}</div>
    </>
  );

  if (readonly) {
    return (
      <div
        className={base}
        style={{ top: topPx, height: heightPx }}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={`?week=${weekParam}&block=${block.id}`}
      scroll={false}
      className={`${base} hover:brightness-110`}
      style={{ top: topPx, height: heightPx }}
    >
      {inner}
    </Link>
  );
}
```

### Task 2.2: `FieldGrid` passes `readonly` through

Modify `app/admin/_components/field-grid.tsx`. Add a `readonly?: boolean` prop and pass it to each `<BlockCard>`.

- [ ] **Step 1:** In the props type, add `readonly?: boolean;`. In the BlockCard render, add `readonly={readonly}`.

Specifically, change the props destructure from:

```typescript
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
```

to:

```typescript
export function FieldGrid({
  fieldId, fieldName, weekStart, weekParam, blocks, teamNameById, readonly = false,
}: {
  fieldId: string;
  fieldName: string;
  weekStart: Date;
  weekParam: string;
  blocks: ScheduleBlock[];
  teamNameById: Map<string, string>;
  readonly?: boolean;
}) {
```

Then in the `BlockCard` call site, add `readonly={readonly}`.

### Task 2.3: `WeekGrid` accepts and forwards `readonly`

Modify `app/admin/_components/week-grid.tsx`. Add prop + forward.

- [ ] **Step 1:** Replace the full file:

```typescript
import type { ScheduleBlock } from '@/lib/types';
import type { WeekBounds } from '@/lib/calendar/week';
import { FieldGrid } from './field-grid';

type Field = { id: string; name: string; short_name: string | null };
type Team = { id: string; name: string };

export function WeekGrid({
  week, fields, blocks, teams, readonly = false,
}: {
  week: WeekBounds;
  fields: Field[];
  blocks: ScheduleBlock[];
  teams: Team[];
  readonly?: boolean;
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
          readonly={readonly}
        />
      ))}
    </div>
  );
}
```

### Task 2.4: `DayList` accepts `readonly`

Modify `app/admin/_components/day-list.tsx`. Add prop; when true, render each block as a plain `<div>` instead of a `<Link>`.

- [ ] **Step 1:** Modify the function signature to accept `readonly?: boolean`:

Current:
```typescript
export function DayList({
  week, fields, blocks, teams, day,
}: {
  week: WeekBounds;
  fields: Field[];
  blocks: ScheduleBlock[];
  teams: Team[];
  day: number;
}) {
```

New:
```typescript
export function DayList({
  week, fields, blocks, teams, day, readonly = false,
}: {
  week: WeekBounds;
  fields: Field[];
  blocks: ScheduleBlock[];
  teams: Team[];
  day: number;
  readonly?: boolean;
}) {
```

Then modify the `<li>` render inside the `.map`:

Current wraps the inner content in `<Link href="..." scroll={false} className="...">`.

Replace with:

```typescript
          <li key={b.id}>
            {readonly ? (
              <div className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
                <div>
                  <div className="font-medium">{label(b, b.team_id ? teamNameById.get(b.team_id) ?? null : null)}</div>
                  <div className="text-xs opacity-70">
                    {fieldNameById.get(b.field_id) ?? b.field_id} · {formatInTimeZone(new Date(b.start_at), TZ, 'h:mm a')} – {formatInTimeZone(new Date(b.end_at), TZ, 'h:mm a')}
                  </div>
                </div>
                <span className="text-xs uppercase tracking-wide opacity-60">{b.source.replace('_', ' ')}</span>
              </div>
            ) : (
              <Link href={`?week=${week.param}&day=${day}&block=${b.id}`} scroll={false} className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
                <div>
                  <div className="font-medium">{label(b, b.team_id ? teamNameById.get(b.team_id) ?? null : null)}</div>
                  <div className="text-xs opacity-70">
                    {fieldNameById.get(b.field_id) ?? b.field_id} · {formatInTimeZone(new Date(b.start_at), TZ, 'h:mm a')} – {formatInTimeZone(new Date(b.end_at), TZ, 'h:mm a')}
                  </div>
                </div>
                <span className="text-xs uppercase tracking-wide opacity-60">{b.source.replace('_', ' ')}</span>
              </Link>
            )}
          </li>
```

### Task 2.5: Build check + commit

- [ ] **Step 1:** `npx --yes tsc --noEmit 2>&1 | tail -5` — expect clean.
- [ ] **Step 2:** `npm run build 2>&1 | tail -10` — expect build succeeds.
- [ ] **Step 3:** Commit:

```bash
git add app/admin/_components/
git commit -m "feat(ui): BlockCard/FieldGrid/WeekGrid/DayList accept readonly prop"
git push
```

---

## Phase 3 — Public `/schedule` route

### Task 3.1: Create the page

Create `app/schedule/page.tsx`:

```typescript
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseWeekParam } from '@/lib/calendar/week';
import type { ScheduleBlock } from '@/lib/types';
import { WeekNav } from '@/app/admin/_components/week-nav';
import { WeekGrid } from '@/app/admin/_components/week-grid';
import { DayList } from '@/app/admin/_components/day-list';

export default async function PublicSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; day?: string }>;
}) {
  const params = await searchParams;
  const week = parseWeekParam(params.week);
  const dayIndex = params.day ? Math.min(6, Math.max(0, Number(params.day))) : 0;

  const admin = createAdminClient();

  const [blocksRes, fieldsRes, teamsRes, syncRes] = await Promise.all([
    admin
      .from('schedule_blocks')
      .select('*')
      .gte('start_at', week.start.toISOString())
      .lt('start_at', week.endExclusive.toISOString())
      .neq('status', 'cancelled')
      .order('start_at')
      .limit(500),
    admin.from('fields').select('id, name, short_name'),
    admin.from('teams').select('id, name'),
    admin
      .from('sync_runs')
      .select('ended_at')
      .eq('source', 'sports_connect')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const blocks = (blocksRes.data ?? []) as ScheduleBlock[];
  const fields = fieldsRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const lastSync = syncRes.data?.ended_at as string | null | undefined;

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <div>
          <div className="text-xs uppercase tracking-wide text-tj-gold">TJYBB</div>
          <h1 className="text-lg font-semibold">Field Schedule — Andrew Reilly Memorial Park</h1>
        </div>
        <Link href="/login" className="text-sm text-tj-gold-soft hover:text-tj-gold underline underline-offset-4">
          Coach / admin sign in →
        </Link>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-3">
          <WeekNav week={week} />
          {lastSync && (
            <div className="text-xs opacity-60">
              Synced {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}
            </div>
          )}
        </div>

        <WeekGrid week={week} fields={fields} blocks={blocks} teams={teams} readonly />
        <DayList week={week} fields={fields} blocks={blocks} teams={teams} day={dayIndex} readonly />

        <p className="text-xs opacity-50">
          Public read-only view. Questions? Ask Meesh.
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 1:** Create the file above.
- [ ] **Step 2:** Build + type-check:

```bash
npx --yes tsc --noEmit 2>&1 | tail -5 && npm run build 2>&1 | grep -E "Route \(app\)|├|└|┌" | head -20
```

Expected: `/schedule` appears in the route list.

- [ ] **Step 3:** Commit:

```bash
git add app/schedule/
git commit -m "feat(public): /schedule route — read-only week view, no auth required"
git push
```

---

## Phase 4 — Login page polish

### Task 4.1: Add TJ header + public link

Modify `app/(auth)/login/page.tsx`. Full replacement:

```typescript
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMessage('');
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-tj-cream text-tj-black">
      <header className="flex items-center justify-between border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <h1 className="text-lg font-semibold">
          <span className="text-tj-gold">PYL</span> Field Manager — TJYBB
        </h1>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5 rounded-lg border border-tj-black/10 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">Sign in</h2>
            <p className="mt-1 text-sm opacity-70">
              Enter your coach email — we&apos;ll send you a magic link.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-sm">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded border border-tj-black/20 px-3 py-2"
              disabled={status === 'sending' || status === 'sent'}
            />
            <button
              type="submit"
              disabled={status === 'sending' || status === 'sent'}
              className="w-full rounded bg-tj-black px-3 py-2 text-tj-cream hover:bg-tj-black/80 disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Check your email' : 'Send magic link'}
            </button>
            {status === 'sent' && (
              <p className="text-xs text-tj-gold">Check your email for the sign-in link.</p>
            )}
            {status === 'error' && (
              <p className="text-xs text-override-red">{errorMessage}</p>
            )}
          </form>

          <div className="border-t border-tj-black/10 pt-4 text-center">
            <Link href="/schedule" className="text-sm underline underline-offset-4 hover:text-tj-gold">
              View public schedule →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 1:** Write the file above.
- [ ] **Step 2:** Build check + commit:

```bash
npx --yes tsc --noEmit 2>&1 | tail -5
git add app/\(auth\)/login/page.tsx
git commit -m "style(login): TJ-branded header + card layout + public schedule link"
git push
```

---

## Phase 5 — Coach portal empty states

### Task 5.1: Update empty-state messages + add no-team banner

Modify `app/coach/page.tsx`. Find the three empty-state messages and the null-team case.

- [ ] **Step 1:** Change the "No upcoming practices" message. Find:

```typescript
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No upcoming practices. Request a slot below.
            </p>
```

Replace with:

```typescript
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No upcoming practices. Check the open windows below, then request a slot.
            </p>
```

- [ ] **Step 2:** Change the "No pending requests" message. Find:

```typescript
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No pending requests.
            </p>
```

Replace with:

```typescript
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No pending requests — submit one above.
            </p>
```

- [ ] **Step 3:** Add a no-team banner. Right before the `<main>` closing tag's first child (or equivalently, just after the header `</header>` closes), add a conditional banner. Find:

```typescript
      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
        <section>
```

Replace with:

```typescript
      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
        {!coach.team_id && (
          <div className="rounded border border-tj-gold bg-tj-gold-soft/40 p-3 text-sm">
            <p className="font-semibold">You&apos;re not assigned to a team yet.</p>
            <p className="mt-1 opacity-80">Contact the admin to be assigned a team before requesting slots.</p>
          </div>
        )}
        <section>
```

- [ ] **Step 4:** Build + commit:

```bash
npx --yes tsc --noEmit 2>&1 | tail -5
git add app/coach/page.tsx
git commit -m "ux(coach): sharper empty states + no-team banner"
git push
```

---

## Phase 6 — Admin nav horizontal scroll

### Task 6.1: Add overflow-x + whitespace-nowrap

Modify `app/admin/_components/admin-nav.tsx`. Find:

```typescript
    <nav className="flex gap-4 border-b border-tj-black/10 bg-white px-6 py-2 text-sm">
```

Replace with:

```typescript
    <nav className="flex gap-4 overflow-x-auto whitespace-nowrap border-b border-tj-black/10 bg-white px-6 py-2 text-sm">
```

- [ ] **Step 1:** Apply the edit.
- [ ] **Step 2:** Commit:

```bash
git add app/admin/_components/admin-nav.tsx
git commit -m "ux(admin): nav scrolls horizontally on narrow viewports"
git push
```

---

## Phase 7 — Local QA + deploy + handoff

### Task 7.1: Manual QA checklist

With `npm run dev` running:

- [ ] `/schedule` loads without login (incognito window); shows the current week
- [ ] Prev/next/today nav works on `/schedule`; URL updates
- [ ] Blocks are visible but not clickable (no drawer)
- [ ] Resize to <768px on `/schedule` → day list appears, still non-clickable
- [ ] Every button shows pointer cursor on hover (check: Sync rec, Sync travel, form submit, nav links styled as buttons)
- [ ] Disabled buttons do NOT show pointer (check: coach Request form with date empty)
- [ ] `/login` shows the black header bar + card-style form + "View public schedule →" link
- [ ] As a coach with no team_id, `/coach` shows yellow "Not assigned" banner
- [ ] Admin on narrow viewport → secondary nav scrolls horizontally
- [ ] All existing functionality still works: sync, override, slot request, approve/deny

### Task 7.2: Deploy

```bash
npx vercel@latest --prod --yes 2>&1 | tail -5
curl -sI https://fields.poweryourleague.com/schedule | head -3
```
Expected: `HTTP/2 200` (public route, no login redirect).

### Task 7.3: Session 6 handoff

Create `docs/sessions/SESSION_6_public_view_and_polish.md` following the Session 5 template. Content:

- What shipped: public view, cursor fix, login polish, empty states, admin nav scroll
- Bugs caught during build (if any)
- Env vars: no changes
- Manual steps Meesh: share the `/schedule` URL with TJYBB parents
- Next steps: roadmap handoff — Sessions 1–6 shipped the full feature spec per `SCOPE.md §9`. Any further work is optional (PYL brand skin if/when the module ports to PYL, public parent view extensions, etc.)

Commit:

```bash
git add docs/sessions/
git commit -m "docs(session-6): handoff — public view, polish, and roadmap complete"
git push
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Global cursor-pointer fix | 1.1 |
| Public `/schedule` route | 3.1 |
| `WeekGrid` readonly prop | 2.3 |
| `BlockCard` readonly prop | 2.1 |
| `FieldGrid` passes readonly | 2.2 |
| `DayList` readonly prop | 2.4 |
| Login TJ header + public link | 4.1 |
| Coach empty states updated | 5.1 |
| No-team banner | 5.1 |
| Admin nav horizontal scroll | 6.1 |
| Footer last-synced on public | 3.1 |
| Deploy + handoff | 7.2, 7.3 |

No gaps.

**Placeholder scan:** no "TODO" / "TBD" / "similar to" references. Every task has full code or exact commands.

**Type consistency:**

- `readonly?: boolean` prop signature consistent across `BlockCard`, `FieldGrid`, `WeekGrid`, `DayList`
- Public `/schedule/page.tsx` imports `WeekNav`, `WeekGrid`, `DayList` from `app/admin/_components/...` — they're reused verbatim with `readonly` flag
- `parseWeekParam` signature used in public view matches admin usage
