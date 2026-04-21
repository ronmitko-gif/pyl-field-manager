# Session 5 — Override Flow + Twilio SMS (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "override travel block for rec makeup" action in the admin drawer, wire Twilio SMS alongside existing email notifications for every coach-facing event, and ship a notifications log page for delivery visibility.

**Architecture:** Twilio SMS is a native-fetch REST wrapper (same pattern as Resend) with three modes (`dev`/`test`/`prod`). Override is a server action that atomically creates the replacement rec block and marks the travel block overridden, then fires notifications for every coach on the affected team. SMS parallels email — both channels always dispatched when coach has a phone, email-only otherwise.

**Tech Stack:** Next.js 16 App Router (server actions + RSCs), TypeScript strict, Tailwind v4 (TJ palette), `@supabase/ssr` + `@supabase/supabase-js`, `date-fns` + `date-fns-tz`, native `fetch` for Twilio (no npm dep), `vitest`.

---

## Preconditions

- [x] Sessions 1–4 shipped
- [x] Spec approved at `docs/superpowers/specs/2026-04-21-session-5-override-and-sms-design.md`
- [x] Resend SMTP working; `RESEND_API_KEY` in env
- [ ] **Meesh:** set up Twilio — create account, get `ACCOUNT_SID`, `AUTH_TOKEN`, and a purchased phone number in E.164 format
- [ ] **Meesh:** apply migration 0004 via Supabase Dashboard

---

## File structure at end of session

```
supabase/
  migrations/
    0004_notifications_skipped.sql            (new)

lib/
  sms/
    send.ts                                   (new — Twilio REST wrapper)
    send.test.ts                              (new — mode-switching logic)
  notifications/
    enqueue.ts                                (modify — add SMS sends + notifyTravelOverridden)

app/
  admin/
    _actions.ts                               (modify — add overrideTravelBlock)
    _components/
      admin-nav.tsx                           (modify — add Notifications link)
      block-drawer.tsx                        (modify — override form + overridden-state banner)
      override-form.tsx                       (new — inline form for override)
    notifications/
      page.tsx                                (new — log viewer)
    layout.tsx                                (unchanged)

.env.example                                  (modify — add TWILIO_* placeholders)
.env.local                                    (modify — set TWILIO_* for dev)

docs/sessions/
  SESSION_5_override_and_sms.md               (new — handoff)
```

No changes to `app/coach/*`. No new dependencies.

---

## Phase 1 — Migration 0004 (notifications.status += 'skipped')

### Task 1.1: Write migration

Create `supabase/migrations/0004_notifications_skipped.sql`:

```sql
alter table notifications drop constraint notifications_status_check;
alter table notifications add constraint notifications_status_check
  check (status in ('pending','sent','failed','delivered','skipped'));
```

### Task 1.2: Apply in Supabase dashboard

- [ ] **Step 1:** Meesh pastes the above SQL into Supabase SQL Editor → Run.
- [ ] **Step 2:** Verify: `select conname from pg_constraint where conname = 'notifications_status_check';` returns 1 row. (No further verification needed — constraint replacement is atomic.)

### Task 1.3: Commit

```bash
git add supabase/migrations/
git commit -m "feat(db): add 'skipped' to notifications.status for no-phone SMS case"
git push
```

---

## Phase 2 — Twilio SMS library (TDD)

### Task 2.1: Write failing test for mode switching

Create `lib/sms/send.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendSms } from './send';

describe('sendSms', () => {
  const originalMode = process.env.TWILIO_MODE;
  const originalSid = process.env.TWILIO_ACCOUNT_SID;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;
  const originalFrom = process.env.TWILIO_FROM_NUMBER;

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
  });

  afterEach(() => {
    process.env.TWILIO_MODE = originalMode;
    process.env.TWILIO_ACCOUNT_SID = originalSid;
    process.env.TWILIO_AUTH_TOKEN = originalToken;
    process.env.TWILIO_FROM_NUMBER = originalFrom;
    vi.restoreAllMocks();
  });

  it('dev mode returns success without network', async () => {
    process.env.TWILIO_MODE = 'dev';
    const spy = vi.spyOn(globalThis, 'fetch');
    const result = await sendSms({ to: '+14125550123', body: 'hello' });
    expect(result).toEqual({ ok: true, id: 'dev-logged' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('prod mode POSTs to Twilio and returns the SID on success', async () => {
    process.env.TWILIO_MODE = 'prod';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
    );
    const result = await sendSms({ to: '+14125550123', body: 'hello' });
    expect(result).toEqual({ ok: true, id: 'SM123' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.twilio.com');
    expect(String(url)).toContain('ACtest/Messages.json');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('returns { ok: false, error } when Twilio responds non-2xx', async () => {
    process.env.TWILIO_MODE = 'prod';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('invalid phone', { status: 400 })
    );
    const result = await sendSms({ to: 'nope', body: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('400');
  });

  it('returns error when TWILIO_ACCOUNT_SID is missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    process.env.TWILIO_MODE = 'prod';
    const result = await sendSms({ to: '+14125550123', body: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('TWILIO_ACCOUNT_SID');
  });
});
```

Run: `npm test`. Expected FAIL: module not found.

### Task 2.2: Implement `sendSms`

Create `lib/sms/send.ts`:

```typescript
import 'server-only';

type SmsInput = { to: string; body: string };

type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type Mode = 'dev' | 'test' | 'prod';

function modeOf(): Mode {
  const m = (process.env.TWILIO_MODE ?? 'prod').toLowerCase();
  if (m === 'dev' || m === 'test' || m === 'prod') return m;
  return 'prod';
}

export async function sendSms(input: SmsInput): Promise<SendResult> {
  const mode = modeOf();

  if (mode === 'dev') {
    // eslint-disable-next-line no-console
    console.log('[sms/dev] to=%s body=%s', input.to, input.body);
    return { ok: true, id: 'dev-logged' };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid) return { ok: false, error: 'TWILIO_ACCOUNT_SID not set' };
  if (!token) return { ok: false, error: 'TWILIO_AUTH_TOKEN not set' };
  if (!from) return { ok: false, error: 'TWILIO_FROM_NUMBER not set' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const basic = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({ From: from, To: input.to, Body: input.body });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { sid: string };
    return { ok: true, id: json.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

Run: `npm test`. Expected: all 4 tests pass.

### Task 2.3: Commit

```bash
git add lib/sms/
git commit -m "feat(sms): Twilio REST wrapper with dev/test/prod modes + tests"
git push
```

---

## Phase 3 — Notifications enqueue extensions

### Task 3.1: Add SMS helper + extend existing functions

Modify `lib/notifications/enqueue.ts`. Full replacement:

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatInTimeZone } from 'date-fns-tz';
import { sendEmail } from '@/lib/email/send';
import { sendSms } from '@/lib/sms/send';

const TZ = 'America/New_York';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fields.poweryourleague.com';

type Coach = { id: string; name: string; email: string; phone?: string | null; team_id: string | null };
type Request = {
  id: string;
  start_at: string;
  end_at: string;
  field_id: string;
  requester_coach_id: string;
  admin_note: string | null;
};

async function persistAndSendEmail(
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
  const result = await sendEmail({ to: params.to, subject: params.subject, html: params.html });
  if (row?.id) {
    if (result.ok) {
      await admin.from('notifications').update({
        status: 'sent', external_id: result.id, sent_at: new Date().toISOString(),
      }).eq('id', row.id);
    } else {
      await admin.from('notifications').update({
        status: 'failed', error_message: result.error,
      }).eq('id', row.id);
    }
  }
}

async function persistAndSendSms(
  admin: SupabaseClient,
  params: {
    orgId: string;
    coachId: string;
    requestId: string | null;
    blockId: string | null;
    body: string;
    to: string | null;
  }
) {
  const { data: row } = await admin
    .from('notifications')
    .insert({
      org_id: params.orgId,
      coach_id: params.coachId,
      request_id: params.requestId,
      block_id: params.blockId,
      channel: 'sms',
      body: params.body.slice(0, 1000),
      status: params.to ? 'pending' : 'skipped',
    })
    .select('id')
    .single();

  if (!params.to) return;

  const result = await sendSms({ to: params.to, body: params.body });
  if (row?.id) {
    if (result.ok) {
      await admin.from('notifications').update({
        status: 'sent', external_id: result.id, sent_at: new Date().toISOString(),
      }).eq('id', row.id);
    } else {
      await admin.from('notifications').update({
        status: 'failed', error_message: result.error,
      }).eq('id', row.id);
    }
  }
}

function fmtWhen(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${formatInTimeZone(s, TZ, 'EEE MMM d')}, ${formatInTimeZone(s, TZ, 'h:mm a')}–${formatInTimeZone(e, TZ, 'h:mm a')}`;
}

function fmtShort(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${formatInTimeZone(s, TZ, 'MMM d h:mm a')}–${formatInTimeZone(e, TZ, 'h:mm a')}`;
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
    await persistAndSendEmail(admin, {
      orgId, coachId: a.id, requestId: request.id, blockId: null,
      subject: `New slot request: ${teamName} on ${formatInTimeZone(new Date(request.start_at), TZ, 'EEE MMM d')}`,
      html, to: a.email,
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
  const short = fmtShort(request.start_at, request.end_at);
  const html = `
    <p>Your slot is confirmed.</p>
    <p><strong>${fieldName}</strong> — ${when}</p>
    ${request.admin_note ? `<p>Note from admin: ${request.admin_note}</p>` : ''}
    <p>See your schedule: <a href="${SITE}/coach">${SITE}/coach</a></p>
  `;
  await persistAndSendEmail(admin, {
    orgId, coachId: requester.id, requestId: request.id, blockId,
    subject: 'Your slot is confirmed', html, to: requester.email,
  });
  await persistAndSendSms(admin, {
    orgId, coachId: requester.id, requestId: request.id, blockId,
    body: `PYL: your ${fieldName} slot ${short} is confirmed.`,
    to: requester.phone ?? null,
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
  const short = fmtShort(request.start_at, request.end_at);
  const reason = superseded
    ? "Another team's request for the same slot was approved first."
    : request.admin_note || 'No reason given.';
  const html = `
    <p>Your slot request was declined.</p>
    <p><strong>${fieldName}</strong> — ${when}</p>
    <p>Reason: ${reason}</p>
    <p>Request another at <a href="${SITE}/coach">${SITE}/coach</a></p>
  `;
  const smsBody = superseded
    ? `PYL: your ${fieldName} ${short} request was declined — another team got the slot first.`
    : `PYL: your ${fieldName} ${short} request was declined. ${reason}`.slice(0, 320);

  await persistAndSendEmail(admin, {
    orgId, coachId: requester.id, requestId: request.id, blockId: null,
    subject: superseded ? 'Your slot request was declined (slot filled)' : 'Your slot request was declined',
    html, to: requester.email,
  });
  await persistAndSendSms(admin, {
    orgId, coachId: requester.id, requestId: request.id, blockId: null,
    body: smsBody, to: requester.phone ?? null,
  });
}

export async function notifyTravelOverridden(
  admin: SupabaseClient,
  orgId: string,
  overridden: { id: string; start_at: string; end_at: string; field_id: string },
  replacementBlockId: string,
  reason: string | null,
  coaches: Coach[],
  fieldName: string
) {
  const when = fmtWhen(overridden.start_at, overridden.end_at);
  const short = fmtShort(overridden.start_at, overridden.end_at);
  const reasonLine = reason ? `<p>Reason: ${reason}</p>` : '';
  const smsReason = reason ? ` Reason: ${reason}.` : '';
  const html = `
    <p>Heads up — your practice has been bumped for a rec makeup.</p>
    <p><strong>${fieldName}</strong> — ${when}</p>
    ${reasonLine}
    <p>Request a replacement slot: <a href="${SITE}/coach">${SITE}/coach</a></p>
  `;
  for (const coach of coaches) {
    await persistAndSendEmail(admin, {
      orgId, coachId: coach.id, requestId: null, blockId: replacementBlockId,
      subject: 'Your practice has been bumped',
      html, to: coach.email,
    });
    const smsBody = `PYL: your ${short} practice at ${fieldName} is bumped for a rec makeup.${smsReason} Request another: ${SITE}/coach`.slice(0, 320);
    await persistAndSendSms(admin, {
      orgId, coachId: coach.id, requestId: null, blockId: replacementBlockId,
      body: smsBody, to: coach.phone ?? null,
    });
  }
}
```

### Task 3.2: Update Coach type passed from _actions.ts

Modify `app/admin/_actions.ts` and `app/coach/_actions.ts` where they call `notifyRequestApproved` / `notifyRequestDenied` / `notifyRequestSubmitted` — add `phone` to the selected columns and pass it through.

In `app/coach/_actions.ts`, inside `submitSlotRequest`:

Find:
```typescript
const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, role, team_id, name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle();
```

Replace with:
```typescript
const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, role, team_id, name, email, phone')
    .eq('auth_user_id', user.id)
    .maybeSingle();
```

Also update the `requireCoach` helper similarly (same file).

In `app/admin/_actions.ts`, inside both `approveSlotRequest` and `denySlotRequest`, find:
```typescript
const { data: requester } = await adminClient
    .from('coaches')
    .select('id, name, email, team_id')
    .eq('id', request.requester_coach_id)
    .maybeSingle();
```

Replace with:
```typescript
const { data: requester } = await adminClient
    .from('coaches')
    .select('id, name, email, phone, team_id')
    .eq('id', request.requester_coach_id)
    .maybeSingle();
```

And when calling `notifyRequestApproved` / `notifyRequestDenied`, pass `phone: requester.phone` in the coach object. Same for `sCoach` in the supersede loop.

Update call sites to include phone in the coach object argument:

```typescript
{ id: requester.id, name: requester.name, email: requester.email, phone: requester.phone, team_id: requester.team_id }
```

(Replacing the existing 4-field object with the 5-field one that includes `phone`.)

### Task 3.3: Type-check + commit

```bash
npx --yes tsc --noEmit
git add lib/notifications/ app/admin/_actions.ts app/coach/_actions.ts
git commit -m "feat(notifications): SMS alongside email + notifyTravelOverridden"
git push
```

---

## Phase 4 — Override UI + server action

### Task 4.1: Override form component

Create `app/admin/_components/override-form.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { overrideTravelBlock } from '../_actions';

export function OverrideForm({ blockId, weekParam }: { blockId: string; weekParam: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    if (!confirm('This will notify the travel coach via email and SMS. Continue?')) return;
    setError(null);
    setSubmitting(true);
    try {
      await overrideTravelBlock(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-override-red px-3 py-1.5 text-sm text-override-red hover:bg-override-red hover:text-white"
      >
        Override for rec makeup
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 rounded border border-override-red bg-override-red/5 p-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-override-red">
        Override for rec makeup
      </div>
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="week_param" value={weekParam} />
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Away team</span>
        <input type="text" name="away_team_raw" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Home team</span>
        <input type="text" name="home_team_raw" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Reason (optional)</span>
        <textarea name="reason" rows={2} maxLength={300} className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-override-red px-3 py-1.5 text-sm font-medium text-white hover:bg-override-red/90 disabled:opacity-50"
        >
          {submitting ? 'Overriding…' : 'Override & notify coach'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-tj-black/20 px-3 py-1.5 text-sm hover:bg-tj-cream"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-override-red">{error}</p>}
    </form>
  );
}
```

### Task 4.2: BlockDrawer update

Modify `app/admin/_components/block-drawer.tsx`. Add override rendering and overridden-state banner. Full replacement:

```typescript
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/server';
import { updateBlock } from '../_actions';
import { OverrideForm } from './override-form';

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

  const { data: replacement } = block.overridden_by_block_id
    ? await supabase
        .from('schedule_blocks')
        .select('id, home_team_raw, away_team_raw, notes')
        .eq('id', block.overridden_by_block_id)
        .maybeSingle()
    : { data: null };

  const start = new Date(block.start_at);
  const end = new Date(block.end_at);
  const editable = ['confirmed', 'cancelled', 'tentative'].includes(block.status);
  const isOverridden = block.status === 'overridden';
  const canOverride =
    ['travel_recurring', 'manual'].includes(block.source) &&
    block.status === 'confirmed' &&
    start > new Date();

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

          {isOverridden && (
            <div className="rounded border border-override-red bg-override-red/10 p-3 text-sm">
              <div className="font-semibold text-override-red">Overridden for rec makeup</div>
              {block.override_reason && <div className="mt-1 text-xs">Reason: {block.override_reason}</div>}
              {replacement && (
                <div className="mt-1 text-xs opacity-80">
                  Replaced by: {replacement.away_team_raw} @ {replacement.home_team_raw}
                  {' · '}
                  <Link href={`?week=${weekParam}&block=${replacement.id}`} scroll={false} className="underline">
                    View replacement
                  </Link>
                </div>
              )}
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

          {canOverride && <OverrideForm blockId={block.id} weekParam={weekParam} />}

          <div className="text-xs opacity-50">Updated {formatInTimeZone(new Date(block.updated_at ?? block.created_at), TZ, 'MMM d, h:mm a')}</div>
        </div>
      </aside>
    </>
  );
}
```

### Task 4.3: `overrideTravelBlock` server action

Append to `app/admin/_actions.ts`:

```typescript
import { notifyTravelOverridden } from '@/lib/notifications/enqueue';

export async function overrideTravelBlock(formData: FormData) {
  const { adminClient } = await requireAdmin();
  const blockId = String(formData.get('block_id') ?? '');
  const awayTeam = String(formData.get('away_team_raw') ?? '').trim();
  const homeTeam = String(formData.get('home_team_raw') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim() || null;
  if (!blockId) throw new Error('Missing block id');
  if (!awayTeam || !homeTeam) throw new Error('Both away and home teams are required');

  const { data: original } = await adminClient
    .from('schedule_blocks')
    .select('id, org_id, field_id, start_at, end_at, team_id, source, status')
    .eq('id', blockId)
    .maybeSingle();
  if (!original) throw new Error('Block not found');
  if (!['travel_recurring', 'manual'].includes(original.source)) {
    throw new Error('Only travel or manual blocks can be overridden');
  }
  if (original.status !== 'confirmed') {
    throw new Error('Only confirmed blocks can be overridden');
  }

  const { data: replacement, error: insErr } = await adminClient
    .from('schedule_blocks')
    .insert({
      org_id: original.org_id,
      field_id: original.field_id,
      team_id: null,
      source: 'override',
      status: 'confirmed',
      start_at: original.start_at,
      end_at: original.end_at,
      home_team_raw: homeTeam,
      away_team_raw: awayTeam,
      notes: reason,
    })
    .select('id')
    .single();
  if (insErr || !replacement) throw new Error(`Replacement insert failed: ${insErr?.message ?? 'unknown'}`);

  const { error: updErr } = await adminClient
    .from('schedule_blocks')
    .update({
      status: 'overridden',
      overridden_by_block_id: replacement.id,
      override_reason: reason,
    })
    .eq('id', original.id);
  if (updErr) throw new Error(`Update failed: ${updErr.message}`);

  if (original.team_id) {
    const { data: coaches } = await adminClient
      .from('coaches')
      .select('id, name, email, phone, team_id')
      .eq('team_id', original.team_id);
    const { data: field } = await adminClient
      .from('fields')
      .select('name')
      .eq('id', original.field_id)
      .maybeSingle();

    if (coaches && coaches.length > 0 && field) {
      await notifyTravelOverridden(
        adminClient,
        original.org_id,
        {
          id: original.id,
          start_at: original.start_at,
          end_at: original.end_at,
          field_id: original.field_id,
        },
        replacement.id,
        reason,
        coaches.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          team_id: c.team_id,
        })),
        field.name
      );
    }
  }

  revalidatePath('/admin');
  revalidatePath('/coach');
}
```

### Task 4.4: Build + commit

```bash
npx --yes tsc --noEmit
npm run build 2>&1 | tail -10
git add app/admin/ lib/notifications/
git commit -m "feat(admin): override travel block for rec makeup + notifications"
git push
```

---

## Phase 5 — Notifications log page

### Task 5.1: Page

Create `app/admin/notifications/page.tsx`:

```typescript
import { formatInTimeZone } from 'date-fns-tz';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';

export const revalidate = 60;

const TZ = 'America/New_York';

type Filter = 'all' | 'email' | 'sms' | 'failed';

function parseFilter(raw: string | undefined): Filter {
  if (raw === 'email' || raw === 'sms' || raw === 'failed') return raw;
  return 'all';
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = parseFilter(params.filter);

  const admin = createAdminClient();
  let query = admin
    .from('notifications')
    .select('id, created_at, sent_at, channel, coach_id, body, status, error_message, external_id')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filter === 'email') query = query.eq('channel', 'email');
  if (filter === 'sms') query = query.eq('channel', 'sms');
  if (filter === 'failed') query = query.eq('status', 'failed');

  const [notesRes, coachesRes] = await Promise.all([
    query,
    admin.from('coaches').select('id, name'),
  ]);
  const notes = notesRes.data ?? [];
  const coachNameById = new Map((coachesRes.data ?? []).map((c) => [c.id, c.name]));

  const chip = (label: string, value: Filter) => {
    const active = filter === value;
    return (
      <Link
        key={value}
        href={value === 'all' ? '/admin/notifications' : `/admin/notifications?filter=${value}`}
        className={
          active
            ? 'rounded-full bg-tj-black px-3 py-1 text-xs text-tj-cream'
            : 'rounded-full border border-tj-black/20 px-3 py-1 text-xs hover:bg-tj-cream'
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Notifications log</h2>
        <p className="text-sm opacity-70">Last 100 outbound messages (auto-refreshes every 60s).</p>
      </header>

      <div className="flex gap-2">
        {chip('All', 'all')}
        {chip('Email', 'email')}
        {chip('SMS', 'sms')}
        {chip('Failed', 'failed')}
      </div>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">Channel</th>
              <th className="p-2">Coach</th>
              <th className="p-2">Preview</th>
              <th className="p-2">Status</th>
              <th className="p-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id} className="border-t border-tj-black/5 align-top">
                <td className="p-2 whitespace-nowrap text-xs" title={formatInTimeZone(new Date(n.created_at), TZ, 'yyyy-MM-dd HH:mm:ss')}>
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </td>
                <td className="p-2">
                  {n.channel === 'email' ? '📧 email' : '📱 sms'}
                </td>
                <td className="p-2">{coachNameById.get(n.coach_id) ?? '—'}</td>
                <td className="p-2 max-w-sm text-xs">
                  {n.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}
                  {n.body.length > 80 ? '…' : ''}
                </td>
                <td className="p-2">
                  <span
                    className={
                      n.status === 'sent'
                        ? 'rounded bg-tj-gold px-2 py-0.5 text-xs text-tj-black'
                        : n.status === 'failed'
                        ? 'rounded bg-override-red px-2 py-0.5 text-xs text-white'
                        : n.status === 'skipped'
                        ? 'rounded border border-tj-black/20 px-2 py-0.5 text-xs'
                        : 'rounded bg-tj-black/70 px-2 py-0.5 text-xs text-tj-cream'
                    }
                  >
                    {n.status}
                  </span>
                </td>
                <td className="p-2 max-w-xs text-xs opacity-70">{n.error_message ?? '—'}</td>
              </tr>
            ))}
            {notes.length === 0 && (
              <tr><td colSpan={6} className="p-3 text-tj-black/50">No notifications yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

### Task 5.2: Update admin nav

Modify `app/admin/_components/admin-nav.tsx` — add one entry to LINKS:

```typescript
const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/coaches', label: 'Coaches' },
  { href: '/admin/fields', label: 'Fields' },
  { href: '/admin/requests', label: 'Requests' },
  { href: '/admin/notifications', label: 'Notifications' },
];
```

### Task 5.3: Commit

```bash
git add app/admin/
git commit -m "feat(admin): notifications log page with channel + status filters"
git push
```

---

## Phase 6 — Env vars + deploy

### Task 6.1: Add Twilio keys to `.env.example`

Modify `.env.example` — append:

```
# --- SMS (Session 5) ---
# Twilio SMS credentials. Create a project at https://www.twilio.com/console
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
# Mode: dev | test | prod (default prod). Dev logs to console without sending.
TWILIO_MODE=prod
```

### Task 6.2: Add to `.env.local`

Meesh pastes their Twilio values into `.env.local`:

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+14125550123
TWILIO_MODE=dev
```

`dev` mode for local — real sends happen only in prod.

### Task 6.3: Push to Vercel

```bash
for VAR in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER; do
  echo "=== $VAR ==="
  node --env-file=.env.local -e "process.stdout.write(process.env.$VAR)" | npx vercel@latest env add $VAR production 2>&1 | tail -3
done
# TWILIO_MODE in prod should be 'prod'
echo prod | npx vercel@latest env add TWILIO_MODE production 2>&1 | tail -3
```

### Task 6.4: Deploy

```bash
npx vercel@latest --prod --yes 2>&1 | tail -6
```

Verify:

```bash
curl -sI https://fields.poweryourleague.com/admin/notifications | head -3
```
Expected: `307` (redirect to login since curl isn't authed).

---

## Phase 7 — Local QA + handoff

### Task 7.1: Manual QA

With `TWILIO_MODE=dev` in `.env.local` + dev server running:

1. Log in as admin → click a future travel_recurring block → drawer shows "Override for rec makeup" button.
2. Click → form expands. Fill in Away + Home team + reason → submit → confirm modal → submit.
3. Dev-server terminal shows `[sms/dev] to=+... body=PYL: ...`.
4. Block on the grid now shows as overridden (strikethrough + ringed); click it → drawer shows "Overridden for rec makeup" banner with replacement link.
5. Click the replacement link → drawer refreshes to the replacement rec block.
6. Go to `/admin/notifications` → see the email + SMS rows (SMS shows `sent` with `id=dev-logged`).
7. Approve / deny a slot request → email + SMS both log.
8. Override a block for a coach with no phone number set → SMS row shows `status=skipped` (no error), email still sent.

### Task 7.2: Prod smoke test (optional, costs ~$0.02 in SMS)

- Set `TWILIO_MODE=prod` in Vercel only.
- Ensure your admin coach row has your real phone number.
- In prod, override a block whose team is you-as-coach → phone gets the SMS.

### Task 7.3: Session handoff

Create `docs/sessions/SESSION_5_override_and_sms.md` using the Session 4 template. Fill in:
- What shipped (Units 1-7)
- Bugs caught
- Env vars added
- Manual steps Meesh does (Twilio account creation, migration apply)
- Session 6 preview: polish, PYL brand skin, first real user

```bash
git add docs/sessions/
git commit -m "docs(session-5): handoff — override + SMS wired, notifications log"
git push
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Twilio lib with dev/test/prod modes | 2.1, 2.2 |
| Coach.phone passed through to notifications | 3.2 |
| SMS on approve/deny/superseded | 3.1 |
| `notifyTravelOverridden` new function | 3.1 |
| Override UI on drawer | 4.1, 4.2 |
| Overridden-state banner + replacement link | 4.2 |
| `overrideTravelBlock` server action | 4.3 |
| Notifications log page | 5.1 |
| Admin nav "Notifications" link | 5.2 |
| Migration 0004 (status='skipped') | 1.1, 1.2 |
| Dev mode logs without Twilio call | 2.2 |
| Skipped status when no phone | 3.1 (persistAndSendSms) |
| TWILIO_* env vars in Vercel | 6.3 |
| 10-second delivery check | 7.2 |

No gaps.

**Placeholder scan:** no "TODO", "TBD", or "similar to" references. Each task has full code or full command.

**Type consistency:**

- `Coach` type in `notifications/enqueue.ts` now includes optional `phone` — matched in all call sites (admin actions + coach actions)
- `overrideTravelBlock` passes `{ id, name, email, phone, team_id }` to `notifyTravelOverridden` — matches Coach type
- SMS templates under 160 chars (Twilio segment limit is 160 for GSM-7; our text is plain ASCII so fine)
- `sendSms` return type `{ ok, id } | { ok, error }` consistent between test + implementation
