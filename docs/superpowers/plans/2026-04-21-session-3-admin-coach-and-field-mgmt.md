# Session 3 — Admin UI: Coaches + Field Mapping (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship coach add/edit pages and a field-edit page, plus a one-click "Fix" link from unmapped-DESCRIPTION sync errors. Unblocks Session 4 (coach portal) by letting Meesh seed real coaches, and unblocks Sports Connect's occasional renames by letting him fix field-mapping in the UI.

**Architecture:** All new pages live under `/admin/*`. Forms use server actions following the Session 2 pattern (`app/admin/_actions.ts`). Coach + field writes use the service-role admin client because the actions are admin-scoped and RLS on `coaches` would block cross-row visibility. Secondary nav is a thin client component that reads `usePathname` for active-link styling.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript strict, Tailwind v4 (TJ palette tokens from Session 2), `@supabase/ssr` for the server-RLS client, `@supabase/supabase-js` for the admin client. No new dependencies.

---

## Preconditions

- [x] Session 1 + 2 shipped
- [x] Spec approved at `docs/superpowers/specs/2026-04-20-session-3-admin-coach-and-field-mgmt-design.md`
- [x] TJ palette tokens already in `app/globals.css`
- [x] `app/admin/_actions.ts` already exists (has `updateBlock`)
- [x] `createAdminClient` already in `lib/supabase/admin.ts`

---

## File structure at end of session

```
app/admin/
  layout.tsx                     (modify — render AdminNav under header)
  page.tsx                       (modify — show "Fix" link for unmapped errors)
  _actions.ts                    (modify — add requireAdmin, createCoach, updateCoach, updateField)
  _components/
    admin-nav.tsx                (new — client, usePathname for active link)
    coach-form.tsx               (new — shared between /new and /[id])
    field-card.tsx               (new — single field edit card)
  coaches/
    page.tsx                     (new — list)
    new/page.tsx                 (new — add form)
    [id]/page.tsx                (new — edit form)
  fields/
    page.tsx                     (new — edit-only list of 2 cards)

docs/sessions/
  SESSION_3_admin_crud.md        (new — handoff)
```

No schema changes. No new env vars. No new deps.

---

## Phase 1 — Secondary admin nav

### Task 1.1: Create AdminNav client component

Create `app/admin/_components/admin-nav.tsx` with:

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/coaches', label: 'Coaches' },
  { href: '/admin/fields', label: 'Fields' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 border-b border-tj-black/10 bg-white px-6 py-2 text-sm">
      {LINKS.map((l) => {
        const isActive =
          l.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(l.href);
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
          </Link>
        );
      })}
    </nav>
  );
}
```

### Task 1.2: Wire AdminNav into admin layout

Modify `app/admin/layout.tsx` — add import and render the nav under the header:

```typescript
import { createClient } from '@/lib/supabase/server';
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
      <AdminNav />
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
```

Type-check with `npx --yes tsc --noEmit`. Commit:

```
git add app/admin/layout.tsx app/admin/_components/admin-nav.tsx
git commit -m "feat(admin): secondary nav (Dashboard/Coaches/Fields) with active-link styling"
git push
```

---

## Phase 2 — Admin-role guard + updateField action

Modify `app/admin/_actions.ts` — preserve existing `updateBlock`, add `requireAdmin` helper and `updateField`. Final file content:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const EDITABLE_STATUSES = new Set(['confirmed', 'cancelled', 'tentative']);

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

export async function updateField(formData: FormData) {
  const { adminClient } = await requireAdmin();

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing field id');

  const scDesc = formData.get('sports_connect_description');
  const hasLights = formData.get('has_lights') === 'on';
  const notesRaw = formData.get('notes');

  const patch = {
    sports_connect_description:
      scDesc === null ? null : String(scDesc).trim() || null,
    has_lights: hasLights,
    notes: notesRaw === null ? null : String(notesRaw).slice(0, 500) || null,
  };

  const { error } = await adminClient.from('fields').update(patch).eq('id', id);
  if (error) throw new Error(`Update failed: ${error.message}`);

  revalidatePath('/admin/fields');
  revalidatePath('/admin');
}
```

Type-check. Commit combined with Phase 3 below.

---

## Phase 3 — Fields edit page

### Task 3.1: FieldCard component

Create `app/admin/_components/field-card.tsx`:

```typescript
import { updateField } from '../_actions';

type Field = {
  id: string;
  name: string;
  short_name: string | null;
  park: string;
  sports_connect_description: string | null;
  has_lights: boolean;
  notes: string | null;
};

export function FieldCard({ field }: { field: Field }) {
  return (
    <article className="rounded-lg border border-tj-black/10 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">{field.name}</h3>
          <p className="text-xs opacity-60">
            {field.park}
            {field.short_name ? ` · ${field.short_name}` : null}
          </p>
        </div>
      </header>

      <form action={updateField} className="flex flex-col gap-3 text-sm">
        <input type="hidden" name="id" value={field.id} />

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">
            Sports Connect description
          </span>
          <input
            type="text"
            name="sports_connect_description"
            defaultValue={field.sports_connect_description ?? ''}
            placeholder="Andrew Reilly Memorial Park > 885 Back Field"
            className="rounded border border-tj-black/20 px-2 py-1"
          />
          <span className="text-xs opacity-60">
            Exact match for the DESCRIPTION field on Sports Connect iCal events.
            A trailing space or mismatched capitalization breaks the sync.
          </span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="has_lights"
            defaultChecked={field.has_lights}
            className="h-4 w-4"
          />
          <span className="text-sm">Has lights</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">
            Notes
          </span>
          <textarea
            name="notes"
            defaultValue={field.notes ?? ''}
            maxLength={500}
            rows={2}
            className="rounded border border-tj-black/20 px-2 py-1"
          />
        </label>

        <div>
          <button
            type="submit"
            className="rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80"
          >
            Save {field.name}
          </button>
        </div>
      </form>
    </article>
  );
}
```

### Task 3.2: Fields page

Create `app/admin/fields/page.tsx`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { FieldCard } from '../_components/field-card';

export default async function FieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ unmapped?: string }>;
}) {
  const params = await searchParams;
  const unmapped = params.unmapped ? decodeURIComponent(params.unmapped) : null;

  const admin = createAdminClient();
  const { data: fields } = await admin
    .from('fields')
    .select('id, name, short_name, park, sports_connect_description, has_lights, notes')
    .order('name');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Fields</h2>
        <p className="text-sm opacity-70">
          Edit the Sports Connect description so iCal events match the right field.
          No fields can be added or removed from this page.
        </p>
      </header>

      {unmapped && (
        <div className="rounded border border-tj-gold bg-tj-gold-soft/40 p-3 text-sm">
          <p className="font-semibold">Recent sync found an unmapped DESCRIPTION:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-xs">
            {unmapped}
          </code>
          <p className="mt-2 opacity-80">
            Paste this string into the right field&apos;s Sports Connect description,
            then click Save and re-run the rec sync.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {(fields ?? []).map((f) => (
          <FieldCard key={f.id} field={f} />
        ))}
      </div>
    </div>
  );
}
```

Type-check + build. Commit:

```
git add app/admin/_actions.ts app/admin/_components/field-card.tsx app/admin/fields/
git commit -m "feat(admin): /admin/fields edit-only page + updateField action + requireAdmin guard"
git push
```

---

## Phase 4 — Sync error "Fix" link on dashboard

Modify the sync-runs `<section>` in `app/admin/page.tsx`. Locate the existing `<section className="rounded-lg border border-tj-black/10 bg-white">` block (the recent-sync-runs table) and replace it entirely with:

```typescript
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
            {runs.map((r) => {
              const errorItems = Array.isArray(r.errors) ? r.errors : [];
              const unmapped = errorItems
                .map((e: { message?: string }) => {
                  const m = /DESCRIPTION="([^"]+)"/.exec(e?.message ?? '');
                  return m ? m[1] : null;
                })
                .filter((s): s is string => Boolean(s));
              const otherErrors = errorItems.filter((e: { message?: string }) =>
                !/DESCRIPTION="/.test(e?.message ?? '')
              );
              return (
                <tr key={r.id} className="border-t border-tj-black/5 align-top">
                  <td className="p-2 whitespace-nowrap">{formatInTimeZone(new Date(r.started_at), TZ, 'MM-dd HH:mm')}</td>
                  <td className="p-2">{r.source}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.events_seen}</td>
                  <td className="p-2">{r.events_inserted}</td>
                  <td className="p-2">{r.events_updated}</td>
                  <td className="p-2">
                    {unmapped.length === 0 && otherErrors.length === 0 && '—'}
                    {unmapped.map((desc: string) => (
                      <div key={desc} className="mb-1 flex items-center gap-2">
                        <code className="rounded bg-tj-cream px-1 py-0.5 text-xs">{desc}</code>
                        <Link
                          href={`/admin/fields?unmapped=${encodeURIComponent(desc)}`}
                          className="rounded bg-tj-gold px-2 py-0.5 text-xs font-medium text-tj-black hover:bg-tj-gold-soft"
                        >
                          Fix →
                        </Link>
                      </div>
                    ))}
                    {otherErrors.length > 0 && (
                      <div className="text-xs opacity-70">
                        {JSON.stringify(otherErrors).slice(0, 60)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr><td colSpan={7} className="p-3 text-tj-black/50">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
```

Add `import Link from 'next/link';` at the top of `app/admin/page.tsx` alongside the existing imports.

Type-check + build. Commit:

```
git add app/admin/page.tsx
git commit -m "feat(admin): surface unmapped DESCRIPTIONs in sync-runs table with Fix link"
git push
```

---

## Phase 5 — Coach form component

Create `app/admin/_components/coach-form.tsx`:

```typescript
import Link from 'next/link';
import { createCoach, updateCoach } from '../_actions';

type Team = { id: string; name: string };
type Coach = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'coach';
  team_id: string | null;
  phone: string | null;
  auth_user_id: string | null;
};

export function CoachForm({
  mode,
  teams,
  coach,
}: {
  mode: 'create' | 'edit';
  teams: Team[];
  coach?: Coach;
}) {
  const action = mode === 'create' ? createCoach : updateCoach;
  const emailLocked = mode === 'edit' && coach?.auth_user_id !== null;

  return (
    <form action={action} className="flex max-w-xl flex-col gap-4 text-sm">
      {mode === 'edit' && coach && <input type="hidden" name="id" value={coach.id} />}

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Name</span>
        <input type="text" name="name" required defaultValue={coach?.name ?? ''} className="rounded border border-tj-black/20 px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Email</span>
        <input type="email" name="email" required defaultValue={coach?.email ?? ''} disabled={emailLocked} className="rounded border border-tj-black/20 px-2 py-1 disabled:bg-tj-cream disabled:opacity-60" />
        {emailLocked && (
          <span className="text-xs opacity-60">Locked because this coach has already logged in.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Role</span>
        <select name="role" defaultValue={coach?.role ?? 'coach'} className="rounded border border-tj-black/20 px-2 py-1">
          <option value="coach">Coach</option>
          <option value="admin">Admin</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Team</span>
        <select name="team_id" defaultValue={coach?.team_id ?? ''} className="rounded border border-tj-black/20 px-2 py-1">
          <option value="">None (admins and unassigned)</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Phone</span>
        <input type="tel" name="phone" defaultValue={coach?.phone ?? ''} placeholder="+14125550123" className="rounded border border-tj-black/20 px-2 py-1" />
      </label>

      <div className="flex gap-2">
        <button type="submit" className="rounded bg-tj-black px-3 py-1.5 text-tj-cream hover:bg-tj-black/80">
          {mode === 'create' ? 'Add coach' : 'Save changes'}
        </button>
        <Link href="/admin/coaches" className="rounded border border-tj-black/20 px-3 py-1.5 hover:bg-tj-cream">Cancel</Link>
      </div>
    </form>
  );
}
```

---

## Phase 6 — Coach CRUD pages + actions

### Task 6.1: Add createCoach + updateCoach to _actions.ts

Update the imports at the top of `app/admin/_actions.ts` to include `redirect`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
```

Append two new actions after `updateField`:

```typescript
export async function createCoach(formData: FormData) {
  const { adminClient, coach: admin } = await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'coach') === 'admin' ? 'admin' : 'coach';
  const teamIdRaw = String(formData.get('team_id') ?? '');
  const team_id = teamIdRaw || null;
  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const phone = phoneRaw || null;

  if (!name) throw new Error('Name is required');
  if (!email) throw new Error('Email is required');

  const { error } = await adminClient.from('coaches').insert({
    org_id: admin.org_id,
    name,
    email,
    role,
    team_id,
    phone,
  });

  if (error) {
    if (error.code === '23505') {
      throw new Error('A coach with that email already exists.');
    }
    throw new Error(`Insert failed: ${error.message}`);
  }

  revalidatePath('/admin/coaches');
  redirect('/admin/coaches');
}

export async function updateCoach(formData: FormData) {
  const { adminClient } = await requireAdmin();

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing coach id');

  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? 'coach') === 'admin' ? 'admin' : 'coach';
  const teamIdRaw = String(formData.get('team_id') ?? '');
  const team_id = teamIdRaw || null;
  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const phone = phoneRaw || null;

  const { data: existing } = await adminClient
    .from('coaches')
    .select('email, auth_user_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) throw new Error('Coach not found');

  const patch: Record<string, unknown> = { name, role, team_id, phone };
  if (!existing.auth_user_id) {
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    if (email) patch.email = email;
  }

  const { error } = await adminClient.from('coaches').update(patch).eq('id', id);
  if (error) {
    if (error.code === '23505') {
      throw new Error('A coach with that email already exists.');
    }
    throw new Error(`Update failed: ${error.message}`);
  }

  revalidatePath('/admin/coaches');
  revalidatePath(`/admin/coaches/${id}`);
  redirect('/admin/coaches');
}
```

### Task 6.2: Coaches list page

Create `app/admin/coaches/page.tsx`:

```typescript
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function CoachesPage() {
  const admin = createAdminClient();
  const [coachesRes, teamsRes] = await Promise.all([
    admin
      .from('coaches')
      .select('id, name, email, role, team_id, phone')
      .order('role', { ascending: false })
      .order('name'),
    admin.from('teams').select('id, name'),
  ]);
  const coaches = coachesRes.data ?? [];
  const teamNameById = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Coaches</h2>
          <p className="text-sm opacity-70">
            Add or edit coach accounts. New coaches log in via magic link with the email below.
          </p>
        </div>
        <Link href="/admin/coaches/new" className="rounded bg-tj-gold px-3 py-1.5 text-sm font-medium text-tj-black hover:bg-tj-gold-soft">
          Add coach
        </Link>
      </header>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Email</th>
              <th className="p-2">Role</th>
              <th className="p-2">Team</th>
              <th className="p-2">Phone</th>
              <th className="p-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {coaches.map((c) => (
              <tr key={c.id} className="border-t border-tj-black/5">
                <td className="p-2 font-medium">{c.name}</td>
                <td className="p-2 opacity-80">{c.email}</td>
                <td className="p-2">
                  <span className={c.role === 'admin' ? 'rounded bg-tj-black px-2 py-0.5 text-xs text-tj-cream' : 'rounded bg-tj-cream px-2 py-0.5 text-xs'}>
                    {c.role}
                  </span>
                </td>
                <td className="p-2">{c.team_id ? teamNameById.get(c.team_id) ?? '—' : '—'}</td>
                <td className="p-2">{c.phone ?? '—'}</td>
                <td className="p-2 text-right">
                  <Link href={`/admin/coaches/${c.id}`} className="text-xs underline hover:no-underline">Edit</Link>
                </td>
              </tr>
            ))}
            {coaches.length === 0 && (
              <tr><td colSpan={6} className="p-3 text-tj-black/50">No coaches yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

### Task 6.3: New coach page

Create `app/admin/coaches/new/page.tsx`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { CoachForm } from '../../_components/coach-form';

export default async function NewCoachPage() {
  const admin = createAdminClient();
  const { data: teams } = await admin.from('teams').select('id, name').order('name');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Add coach</h2>
        <p className="text-sm opacity-70">
          Creates a coach row. The coach can log in immediately via magic link — their
          account gets linked on first login.
        </p>
      </header>
      <CoachForm mode="create" teams={teams ?? []} />
    </div>
  );
}
```

### Task 6.4: Edit coach page

Create `app/admin/coaches/[id]/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { CoachForm } from '../../_components/coach-form';

export default async function EditCoachPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const [coachRes, teamsRes] = await Promise.all([
    admin
      .from('coaches')
      .select('id, name, email, role, team_id, phone, auth_user_id')
      .eq('id', id)
      .maybeSingle(),
    admin.from('teams').select('id, name').order('name'),
  ]);
  const coach = coachRes.data;
  if (!coach) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Edit coach</h2>
        <p className="text-sm opacity-70">
          {coach.auth_user_id
            ? 'This coach has already logged in — email is locked.'
            : 'This coach has not logged in yet — email can still be changed.'}
        </p>
      </header>
      <CoachForm mode="edit" teams={teamsRes.data ?? []} coach={coach} />
    </div>
  );
}
```

Type-check + build. Commit:

```
git add app/admin/_actions.ts app/admin/_components/coach-form.tsx app/admin/coaches/
git commit -m "feat(admin): coach CRUD (list/new/edit) + createCoach/updateCoach actions"
git push
```

---

## Phase 7 — Local QA

Manual run-through with dev server (`npm run dev`):

- [ ] `/admin/coaches` loads; shows Meesh as the only admin.
- [ ] "Add coach" creates a new coach; redirects back to list with row visible.
- [ ] New coach logs in via magic link → lands on `/coach` (role-based redirect).
- [ ] Edit that coach → email field is locked (auth_user_id set).
- [ ] Edit phone → save → persisted.
- [ ] Duplicate-email create → friendly error.
- [ ] `/admin/fields` shows 2 cards; editing notes persists.
- [ ] Dashboard sync-runs table shows unmapped DESCRIPTIONs with Fix link → click → banner renders on fields page.
- [ ] Secondary nav renders on all admin pages with active link in gold.

Fix iteratively; commit per fix.

---

## Phase 8 — Deploy + handoff

```
npx vercel@latest --prod --yes
curl -sI https://fields.poweryourleague.com/admin | head -3
```

Create `docs/sessions/SESSION_3_admin_crud.md` following the SESSION_2 template: goal, scope delivered, bugs caught, verification checklist, env vars unchanged, manual steps Meesh needs (add remaining 4 travel coaches), Session 4 preview.

Commit + push.

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Secondary nav | 1.1, 1.2 |
| requireAdmin helper | Phase 2 |
| updateField server action | Phase 2 |
| /admin/fields edit-only page | 3.1, 3.2 |
| Unmapped-description banner | 3.2 |
| Fix link in sync-runs table | Phase 4 |
| CoachForm shared component | Phase 5 |
| Email lock when auth_user_id set | Phase 5, 6.1 |
| createCoach + updateCoach | 6.1 |
| /admin/coaches list | 6.2 |
| /admin/coaches/new | 6.3 |
| /admin/coaches/[id] edit | 6.4 |
| Duplicate-email friendly error | 6.1 (PG 23505 → message) |

No gaps.

**Placeholder scan:** no TODOs, TBDs, or "similar to" references.

**Type consistency:**

- `Coach` shape in `CoachForm` matches what `app/admin/coaches/[id]/page.tsx` selects
- `Team` shape `{ id; name }` consistent across list + form + pages
- `Field` shape in `FieldCard` matches columns selected in `/admin/fields/page.tsx`
- All server actions accept `FormData` and use `String(formData.get(...))`
- `requireAdmin()` returns `{ adminClient, coach }` everywhere
