# Session 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed Next.js 15 + Supabase app at `fields.poweryourleague.com` where Meesh can log in via magic link and see real rec games ingested hourly from the Sports Connect iCal feed.

**Architecture:** Next.js 15 App Router with three server-side Supabase clients (browser / RSC / service-role-admin). Sports Connect iCal is the source of truth for rec games, pulled via Vercel Cron every hour at `:15`. All times stored UTC; displayed America/New_York. RLS is on from day one with `org_id` on every tenant-scoped table so this lifts cleanly into PYL multi-tenancy later.

**Tech Stack:** Next.js 15, TypeScript strict, Tailwind v4, `@supabase/ssr`, `@supabase/supabase-js`, `node-ical`, `date-fns`, `date-fns-tz`, `vitest`, Vercel (hosting + Cron).

---

## Preconditions

- [x] `.gitignore` created (blocks `.env*.local`)
- [x] `.env.example` created (template, safe to commit)
- [x] `.env.local` created with `CRON_SECRET`, `SPORTS_CONNECT_ICAL_URL`, `ADMIN_EMAIL` pre-filled
- [x] **User:** Supabase creds pasted into `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- [x] GitHub repo ready at `https://github.com/ronmitko-gif/pyl-field-manager.git` (empty)
- [x] Node 24.x, npm 11.x, git installed
- [ ] **Meesh interactive step at end:** configure DNS for `fields.poweryourleague.com`
- [ ] **Meesh interactive step mid-plan:** paste migration + seed SQL into Supabase Dashboard SQL Editor

---

## File structure that will exist at end of session

```
pyl-field-manager/
├── .env.example                                (exists)
├── .env.local                                  (exists, gitignored)
├── .gitignore                                  (exists; will be re-merged after create-next-app)
├── CLAUDE.md / AGENTS.md / SCOPE.md            (exists)
├── README.md                                   (from create-next-app, will update)
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (auth)/auth/callback/route.ts
│   ├── admin/layout.tsx
│   ├── admin/page.tsx
│   ├── coach/page.tsx
│   ├── api/sync/sports-connect/route.ts
│   ├── globals.css                             (from create-next-app)
│   ├── layout.tsx                              (from create-next-app, minor edits)
│   └── page.tsx                                (rewritten: role-based redirect)
├── lib/
│   ├── supabase/client.ts
│   ├── supabase/server.ts
│   ├── supabase/admin.ts
│   ├── ical/parser.ts
│   ├── ical/parser.test.ts
│   ├── ical/ingest.ts
│   ├── ical/fixtures/sample.ics
│   └── types.ts
├── supabase/
│   ├── migrations/0001_initial_schema.sql
│   └── seed.sql
├── docs/
│   ├── sessions/SESSION_1_foundation.md        (exists)
│   ├── superpowers/plans/2026-04-17-session-1-foundation.md (this file)
│   └── BACKLOG.md                              (exists)
├── middleware.ts
├── vercel.json
├── next.config.ts                              (from create-next-app)
├── tsconfig.json                               (from create-next-app; strict enabled)
├── tailwind.config.ts                          (or postcss.config.mjs for Tailwind v4)
├── vitest.config.ts
└── package.json                                (from create-next-app; deps added)
```

---

## Phase 1 — Project scaffold

### Task 1.1: Stage `.gitignore` out of the way

`create-next-app` refuses to run in a non-empty dir if any file conflicts. The only conflict is `.gitignore`.

- [ ] **Step 1:** Move `.gitignore` temporarily

```bash
mv .gitignore .gitignore.bak
```

### Task 1.2: Scaffold Next.js 15 app

- [ ] **Step 1:** Run `create-next-app` in the current directory with all defaults flagged

```bash
npx --yes create-next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --eslint \
  --import-alias "@/*" \
  --use-npm \
  --turbopack \
  --skip-install \
  --yes
```

Expected: creates `app/`, `public/`, `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.gitignore`, `README.md`. Does not install deps (we'll batch with ours).

- [ ] **Step 2:** Verify `tsconfig.json` has `"strict": true`

```bash
grep -E '"strict"\s*:\s*true' tsconfig.json
```
Expected: one match. If missing, edit `tsconfig.json` to set `"strict": true` inside `compilerOptions`.

### Task 1.3: Restore expanded `.gitignore`

The create-next-app `.gitignore` is a subset of ours (missing supabase state, DS_Store, explicit env blocking).

- [ ] **Step 1:** Overwrite `.gitignore` with the expanded version

```gitignore
# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files
.env*.local
.env
!.env.example

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts

# supabase local state
supabase/.branches/
supabase/.temp/

# logs
*.log
```

- [ ] **Step 2:** Remove the backup and verify

```bash
rm .gitignore.bak
grep -E '^\.env' .gitignore
```
Expected: `.env*.local`, `.env`, `!.env.example` lines present.

### Task 1.4: Install all dependencies in one install

- [ ] **Step 1:** Add production deps

```bash
npm install @supabase/supabase-js @supabase/ssr node-ical date-fns date-fns-tz
```

- [ ] **Step 2:** Add dev deps (types + test framework)

```bash
npm install --save-dev @types/node-ical vitest @vitejs/plugin-react
```

- [ ] **Step 3:** Verify the install

```bash
npm ls @supabase/ssr node-ical vitest --depth=0
```
Expected: all three listed without `UNMET` or errors.

### Task 1.5: Initial commit and push

- [ ] **Step 1:** Init git and point at GitHub

```bash
git init
git branch -M main
git remote add origin https://github.com/ronmitko-gif/pyl-field-manager.git
```

- [ ] **Step 2:** Sanity-check `.env.local` is NOT staged

```bash
git add -n .env.local
```
Expected: output is `The following paths are ignored by one of your .gitignore files:` OR empty. If it says `add '.env.local'`, STOP and fix .gitignore first.

- [ ] **Step 3:** Stage, commit, push

```bash
git add .
git status
git commit -m "chore: scaffold Next.js 15 + Tailwind + Supabase + node-ical deps"
git push -u origin main
```

If push is rejected because the GitHub repo has a default README/LICENSE, run `git pull --rebase origin main` first, then re-push.

---

## Phase 2 — Database schema + seed

### Task 2.1: Write the migration file

- [ ] **Step 1:** Create `supabase/migrations/` and the migration file

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 2:** Create `supabase/migrations/0001_initial_schema.sql` with the exact contents below

```sql
-- Organizations (future multi-tenancy placeholder; for now just 'tjybb')
create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz default now()
);

-- Fields (physical fields we schedule against)
create table fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  name text not null,
  short_name text,
  park text not null,
  sports_connect_description text,
  has_lights boolean default false,
  notes text,
  created_at timestamptz default now()
);
create index on fields (sports_connect_description);

-- Teams
create table teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  name text not null,
  team_type text not null check (team_type in ('rec','travel')),
  division text,
  age_group text,
  created_at timestamptz default now()
);

-- Coaches (and admins — admins are coaches with role='admin')
create table coaches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  team_id uuid references teams(id),
  auth_user_id uuid,
  name text not null,
  email text unique not null,
  phone text,
  role text not null default 'coach' check (role in ('admin','coach')),
  created_at timestamptz default now()
);
create index on coaches (email);
create index on coaches (auth_user_id);

-- Recurring travel slot definitions
create table travel_recurring_slots (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) not null,
  field_id uuid references fields(id) not null,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz default now()
);

-- Concrete time blocks
create table schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  field_id uuid references fields(id) not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source text not null check (source in ('sports_connect','travel_recurring','manual','override','open_slot')),
  source_uid text,
  team_id uuid references teams(id),
  home_team_raw text,
  away_team_raw text,
  status text not null default 'confirmed' check (status in ('confirmed','tentative','overridden','cancelled','open')),
  overridden_by_block_id uuid references schedule_blocks(id),
  override_reason text,
  notes text,
  raw_summary text,
  raw_description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index on schedule_blocks (source, source_uid) where source_uid is not null;
create index on schedule_blocks (field_id, start_at);
create index on schedule_blocks (team_id, start_at);
create index on schedule_blocks (status);

-- Slot requests
create table slot_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  requesting_team_id uuid references teams(id) not null,
  requester_coach_id uuid references coaches(id) not null,
  requested_block_id uuid references schedule_blocks(id) not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled')),
  admin_note text,
  created_at timestamptz default now(),
  resolved_at timestamptz
);
create index on slot_requests (status, created_at);

-- Notifications log
create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) not null,
  coach_id uuid references coaches(id) not null,
  channel text not null check (channel in ('sms','email')),
  block_id uuid references schedule_blocks(id),
  request_id uuid references slot_requests(id),
  body text not null,
  external_id text,
  status text not null default 'pending' check (status in ('pending','sent','failed','delivered')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz default now()
);
create index on notifications (coach_id, created_at desc);

-- Sync run audit log
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  events_seen int default 0,
  events_inserted int default 0,
  events_updated int default 0,
  events_unchanged int default 0,
  errors jsonb,
  status text not null default 'running' check (status in ('running','success','partial','failed'))
);
create index on sync_runs (source, started_at desc);

-- Update timestamp trigger for schedule_blocks
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger schedule_blocks_updated_at
  before update on schedule_blocks
  for each row execute function set_updated_at();

-- RLS: enable on all user-facing tables
alter table organizations enable row level security;
alter table fields enable row level security;
alter table teams enable row level security;
alter table coaches enable row level security;
alter table travel_recurring_slots enable row level security;
alter table schedule_blocks enable row level security;
alter table slot_requests enable row level security;
alter table notifications enable row level security;

-- Helpers
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from coaches
    where auth_user_id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer;

create or replace function my_team_ids() returns setof uuid as $$
  select team_id from coaches where auth_user_id = auth.uid() and team_id is not null;
$$ language sql stable security definer;

-- Policies
create policy "admin full access" on organizations for all using (is_admin());
create policy "read all orgs for authed users" on organizations for select using (auth.uid() is not null);

create policy "admin full access fields" on fields for all using (is_admin());
create policy "authed can read fields" on fields for select using (auth.uid() is not null);

create policy "admin full access teams" on teams for all using (is_admin());
create policy "authed can read teams" on teams for select using (auth.uid() is not null);

create policy "admin full access coaches" on coaches for all using (is_admin());
create policy "coaches see self" on coaches for select using (auth_user_id = auth.uid());

create policy "admin full access recurring" on travel_recurring_slots for all using (is_admin());
create policy "coaches see their team recurring" on travel_recurring_slots for select
  using (team_id in (select my_team_ids()));

create policy "admin full access blocks" on schedule_blocks for all using (is_admin());
create policy "authed can read blocks" on schedule_blocks for select using (auth.uid() is not null);

create policy "admin full access requests" on slot_requests for all using (is_admin());
create policy "coaches see own requests" on slot_requests for select
  using (requester_coach_id in (select id from coaches where auth_user_id = auth.uid()));
create policy "coaches insert own requests" on slot_requests for insert
  with check (requester_coach_id in (select id from coaches where auth_user_id = auth.uid()));

create policy "admin full access notifications" on notifications for all using (is_admin());
create policy "coaches see own notifications" on notifications for select
  using (coach_id in (select id from coaches where auth_user_id = auth.uid()));
```

### Task 2.2: Apply the migration via Supabase Dashboard

- [ ] **Step 1:** Meesh opens Supabase Dashboard → `pyl-field-manager` project → **SQL Editor** → **New query**
- [ ] **Step 2:** Paste the entire contents of `supabase/migrations/0001_initial_schema.sql` and click **Run**
- [ ] **Step 3:** Verify in the **Table Editor** that all 9 tables appear (`organizations`, `fields`, `teams`, `coaches`, `travel_recurring_slots`, `schedule_blocks`, `slot_requests`, `notifications`, `sync_runs`)
- [ ] **Step 4:** Verify RLS is on: in the Table Editor each table's tooltip should show "RLS enabled"

### Task 2.3: Write the seed file

- [ ] **Step 1:** Create `supabase/seed.sql`. Uses natural-key upserts so re-running is safe. Open slot blocks for the next 4 weeks are generated via a `generate_series` expression that computes America/New_York wall-clock times and converts to UTC.

```sql
-- Organization
insert into organizations (slug, name)
  values ('tjybb', 'Thomas Jefferson Youth Baseball')
  on conflict (slug) do nothing;

-- Fields
insert into fields (org_id, name, short_name, park, sports_connect_description, has_lights)
  select o.id, v.name, v.short_name, v.park, v.sc_desc, v.lights
  from organizations o,
    (values
      ('885 Back Field',  'Back',          'Andrew Reilly Memorial Park', 'Andrew Reilly Memorial Park > 885 Back Field',          true),
      ('885 Front Field', 'Front (Huber)', 'Andrew Reilly Memorial Park', 'Andrew Reilly Memorial Park > 885 Front Field (Huber)', true)
    ) as v(name, short_name, park, sc_desc, lights)
  where o.slug = 'tjybb'
    and not exists (select 1 from fields f where f.name = v.name and f.org_id = o.id);

-- Teams
insert into teams (org_id, name, team_type, division, age_group)
  select o.id, v.name, v.team_type, v.division, v.age_group
  from organizations o,
    (values
      ('9U B Jaguars — Mitko',     'travel', '9U',     '9U'),
      ('9U A Jaguars — Hennessy',  'travel', '9U',     '9U'),
      ('10U B Jaguars — Ackerman', 'travel', '10U',    '10U'),
      ('10U A Jaguars — Foster',   'travel', '10U',    '10U'),
      ('9U C Jaguars — Motycki',   'travel', '9U',     '9U'),
      ('Rec Minors',               'rec',    'Minors', null)
    ) as v(name, team_type, division, age_group)
  where o.slug = 'tjybb'
    and not exists (select 1 from teams t where t.name = v.name and t.org_id = o.id);

-- Admin coach
insert into coaches (org_id, name, email, role)
  select o.id, 'Meesh', 'meesh@poweryourleague.com', 'admin'
  from organizations o
  where o.slug = 'tjybb'
    and not exists (select 1 from coaches c where c.email = 'meesh@poweryourleague.com');

-- Travel recurring slots (all at 885 Back Field)
insert into travel_recurring_slots (team_id, field_id, day_of_week, start_time, end_time, effective_from)
  select t.id, f.id, v.dow, v.start_t, v.end_t, current_date
  from teams t
  join organizations o on o.id = t.org_id and o.slug = 'tjybb'
  join fields f on f.org_id = o.id and f.name = '885 Back Field',
    (values
      ('9U B Jaguars — Mitko',     1, '20:00'::time, '22:00'::time),
      ('9U A Jaguars — Hennessy',  2, '20:00'::time, '22:00'::time),
      ('10U B Jaguars — Ackerman', 3, '20:00'::time, '22:00'::time),
      ('10U A Jaguars — Foster',   4, '20:00'::time, '22:00'::time),
      ('9U C Jaguars — Motycki',   6, '09:00'::time, '11:00'::time)
    ) as v(team_name, dow, start_t, end_t)
  where t.name = v.team_name
    and not exists (
      select 1 from travel_recurring_slots s
      where s.team_id = t.id and s.day_of_week = v.dow and s.start_time = v.start_t
    );

-- Open slot blocks: next 4 weeks (28 days), at 885 Back Field, wall-clock
-- times in America/New_York converted to UTC via AT TIME ZONE.
-- Fri 20:00, Sat 11:00 / 13:00 / 15:00 / 17:00, Sun 09:00 / 11:00 / 13:00 / 15:00 / 17:00.
-- All 2-hour blocks.
insert into schedule_blocks (org_id, field_id, start_at, end_at, source, status, notes)
  select o.id, f.id,
         ((day + start_time) at time zone 'America/New_York') as start_at,
         ((day + start_time + interval '2 hours') at time zone 'America/New_York') as end_at,
         'open_slot', 'open', 'Seeded open slot'
  from organizations o
  join fields f on f.org_id = o.id and f.name = '885 Back Field',
    lateral (
      select generate_series(current_date, current_date + interval '27 days', interval '1 day')::date as day
    ) d,
    lateral (
      select * from (values
        (5, time '20:00'),  -- Friday
        (6, time '11:00'),  -- Saturday
        (6, time '13:00'),
        (6, time '15:00'),
        (6, time '17:00'),
        (0, time '09:00'),  -- Sunday (Postgres: extract(dow from day) returns 0 for Sunday)
        (0, time '11:00'),
        (0, time '13:00'),
        (0, time '15:00'),
        (0, time '17:00')
      ) as w(dow, start_time)
    ) w
  where o.slug = 'tjybb'
    and extract(dow from d.day)::int = w.dow
    and not exists (
      select 1 from schedule_blocks b
      where b.field_id = f.id
        and b.source = 'open_slot'
        and b.start_at = ((d.day + w.start_time) at time zone 'America/New_York')
    );
```

### Task 2.4: Apply the seed via Supabase Dashboard

- [ ] **Step 1:** In the same SQL Editor, paste the contents of `supabase/seed.sql` → Run
- [ ] **Step 2:** Verify in the Table Editor:
  - `organizations`: 1 row (`tjybb`)
  - `fields`: 2 rows
  - `teams`: 6 rows
  - `coaches`: 1 row (Meesh, admin)
  - `travel_recurring_slots`: 5 rows
  - `schedule_blocks`: ~40 rows (10 windows × 4 weeks)
- [ ] **Step 3:** Commit the migration + seed

```bash
git add supabase/
git commit -m "feat(db): initial schema + seed — orgs, fields, teams, admin, open slots"
git push
```

---

## Phase 3 — Supabase clients

### Task 3.1: Browser client

- [ ] **Step 1:** Create `lib/supabase/client.ts`

```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

### Task 3.2: Server (RSC + route handler) client

- [ ] **Step 1:** Create `lib/supabase/server.ts`

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignored — called from a Server Component; middleware refreshes session.
          }
        },
      },
    }
  );
}
```

### Task 3.3: Service-role admin client (server-only)

- [ ] **Step 1:** Create `lib/supabase/admin.ts`

```typescript
import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'createAdminClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

Note: the `'server-only'` import makes Next.js throw at build time if this file is ever imported from client code — keeps the service-role key from leaking.

### Task 3.4: Shared domain types

- [ ] **Step 1:** Create `lib/types.ts`

```typescript
export type Role = 'admin' | 'coach';

export type BlockSource =
  | 'sports_connect'
  | 'travel_recurring'
  | 'manual'
  | 'override'
  | 'open_slot';

export type BlockStatus =
  | 'confirmed'
  | 'tentative'
  | 'overridden'
  | 'cancelled'
  | 'open';

export type TeamType = 'rec' | 'travel';

export type Coach = {
  id: string;
  org_id: string;
  team_id: string | null;
  auth_user_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
};

export type ScheduleBlock = {
  id: string;
  org_id: string;
  field_id: string;
  start_at: string;
  end_at: string;
  source: BlockSource;
  source_uid: string | null;
  team_id: string | null;
  home_team_raw: string | null;
  away_team_raw: string | null;
  status: BlockStatus;
  raw_summary: string | null;
  raw_description: string | null;
};

export type NormalizedEvent = {
  uid: string;
  start_at: Date;
  end_at: Date;
  summary: string;
  description: string;
  park: string | null;
  field_name: string | null;
  home_team_raw: string | null;
  away_team_raw: string | null;
};
```

- [ ] **Step 2:** Commit

```bash
git add lib/
git commit -m "feat(lib): supabase clients + shared domain types"
git push
```

---

## Phase 4 — iCal parser (TDD)

### Task 4.1: Configure Vitest

- [ ] **Step 1:** Create `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
```

- [ ] **Step 2:** Add `test` script to `package.json` — open the file and add inside `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

### Task 4.2: Create a test fixture

- [ ] **Step 1:** Create `lib/ical/fixtures/sample.ics`

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TJYBB Test//EN
BEGIN:VEVENT
UID:game-12345@sportsconnect.test
DTSTAMP:20260418T120000Z
DTSTART:20260420T230000Z
DTEND:20260421T003000Z
SUMMARY:Pirates @ Orioles
DESCRIPTION:Andrew Reilly Memorial Park > 885 Back Field
END:VEVENT
BEGIN:VEVENT
UID:game-67890@sportsconnect.test
DTSTAMP:20260418T120000Z
DTSTART:20260421T230000Z
DTEND:20260422T003000Z
SUMMARY:Cardinals @ Yankees
DESCRIPTION:Andrew Reilly Memorial Park > 885 Front Field (Huber)
END:VEVENT
END:VCALENDAR
```

### Task 4.3: Write the failing test

- [ ] **Step 1:** Create `lib/ical/parser.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseIcal } from './parser';

const fixture = readFileSync(
  path.join(__dirname, 'fixtures/sample.ics'),
  'utf8'
);

describe('parseIcal', () => {
  it('extracts UID, start/end, summary, and description for each VEVENT', () => {
    const events = parseIcal(fixture);
    expect(events).toHaveLength(2);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test');
    expect(first).toBeDefined();
    expect(first!.summary).toBe('Pirates @ Orioles');
    expect(first!.description).toBe(
      'Andrew Reilly Memorial Park > 885 Back Field'
    );
  });

  it('splits description into park and field name on " > "', () => {
    const events = parseIcal(fixture);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test')!;
    expect(first.park).toBe('Andrew Reilly Memorial Park');
    expect(first.field_name).toBe('885 Back Field');
  });

  it('splits summary on " @ " into away / home team names', () => {
    const events = parseIcal(fixture);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test')!;
    expect(first.away_team_raw).toBe('Pirates');
    expect(first.home_team_raw).toBe('Orioles');
  });

  it('preserves UTC dates (no TZ re-application)', () => {
    const events = parseIcal(fixture);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test')!;
    expect(first.start_at.toISOString()).toBe('2026-04-20T23:00:00.000Z');
    expect(first.end_at.toISOString()).toBe('2026-04-21T00:30:00.000Z');
  });
});
```

- [ ] **Step 2:** Run — expected to fail

```bash
npm test
```
Expected: `Cannot find module './parser'` or equivalent.

### Task 4.4: Implement the parser

- [ ] **Step 1:** Create `lib/ical/parser.ts`

```typescript
import ical from 'node-ical';
import type { NormalizedEvent } from '@/lib/types';

function splitDescription(description: string) {
  const parts = description.split(' > ');
  if (parts.length !== 2) return { park: null, field_name: null };
  return { park: parts[0].trim(), field_name: parts[1].trim() };
}

function splitSummary(summary: string) {
  const parts = summary.split(' @ ');
  if (parts.length !== 2) {
    return { away_team_raw: null, home_team_raw: null };
  }
  return {
    away_team_raw: parts[0].trim(),
    home_team_raw: parts[1].trim(),
  };
}

export function parseIcal(icsText: string): NormalizedEvent[] {
  const parsed = ical.sync.parseICS(icsText);
  const events: NormalizedEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const entry = parsed[key];
    if (entry.type !== 'VEVENT') continue;
    const uid = typeof entry.uid === 'string' ? entry.uid : null;
    if (!uid || !entry.start || !entry.end) continue;
    const summary = typeof entry.summary === 'string' ? entry.summary : '';
    const description =
      typeof entry.description === 'string' ? entry.description : '';
    const { park, field_name } = splitDescription(description);
    const { away_team_raw, home_team_raw } = splitSummary(summary);
    events.push({
      uid,
      start_at: new Date(entry.start),
      end_at: new Date(entry.end),
      summary,
      description,
      park,
      field_name,
      away_team_raw,
      home_team_raw,
    });
  }
  return events;
}

export async function fetchAndParseIcal(url: string): Promise<NormalizedEvent[]> {
  const httpsUrl = url.replace(/^webcal:\/\//i, 'https://');
  const res = await fetch(httpsUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`iCal fetch failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseIcal(text);
}
```

- [ ] **Step 2:** Run tests — expected all pass

```bash
npm test
```
Expected: `4 passed`.

- [ ] **Step 3:** Commit

```bash
git add lib/ical/ vitest.config.ts package.json
git commit -m "feat(ical): VEVENT parser with description/summary splitting and UTC preservation"
git push
```

---

## Phase 5 — iCal ingestor + sync API route

### Task 5.1: Write the ingestor

- [ ] **Step 1:** Create `lib/ical/ingest.ts`

```typescript
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedEvent } from '@/lib/types';

type IngestCounts = {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: { uid: string; message: string }[];
};

export async function ingestEvents(
  supabase: SupabaseClient,
  orgId: string,
  events: NormalizedEvent[]
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    seen: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  const { data: fields, error: fieldsErr } = await supabase
    .from('fields')
    .select('id, sports_connect_description, org_id')
    .eq('org_id', orgId);
  if (fieldsErr) throw new Error(`Load fields failed: ${fieldsErr.message}`);

  const fieldByDesc = new Map<string, string>();
  for (const f of fields ?? []) {
    if (f.sports_connect_description) {
      fieldByDesc.set(f.sports_connect_description, f.id);
    }
  }

  for (const ev of events) {
    counts.seen += 1;
    const fieldId = fieldByDesc.get(ev.description);
    if (!fieldId) {
      counts.errors.push({
        uid: ev.uid,
        message: `No field match for DESCRIPTION="${ev.description}"`,
      });
      continue;
    }

    const { data: existing, error: selErr } = await supabase
      .from('schedule_blocks')
      .select('id, start_at, end_at, raw_summary, raw_description, status')
      .eq('source', 'sports_connect')
      .eq('source_uid', ev.uid)
      .maybeSingle();
    if (selErr) {
      counts.errors.push({ uid: ev.uid, message: `Lookup failed: ${selErr.message}` });
      continue;
    }

    const payload = {
      org_id: orgId,
      field_id: fieldId,
      start_at: ev.start_at.toISOString(),
      end_at: ev.end_at.toISOString(),
      source: 'sports_connect' as const,
      source_uid: ev.uid,
      home_team_raw: ev.home_team_raw,
      away_team_raw: ev.away_team_raw,
      status: 'confirmed' as const,
      raw_summary: ev.summary,
      raw_description: ev.description,
    };

    if (!existing) {
      const { error: insErr } = await supabase
        .from('schedule_blocks')
        .insert(payload);
      if (insErr) {
        counts.errors.push({ uid: ev.uid, message: `Insert failed: ${insErr.message}` });
      } else {
        counts.inserted += 1;
      }
      continue;
    }

    const needsUpdate =
      existing.start_at !== payload.start_at ||
      existing.end_at !== payload.end_at ||
      existing.raw_summary !== payload.raw_summary ||
      existing.raw_description !== payload.raw_description;

    if (!needsUpdate) {
      counts.unchanged += 1;
      continue;
    }

    const { error: updErr } = await supabase
      .from('schedule_blocks')
      .update(payload)
      .eq('id', existing.id);
    if (updErr) {
      counts.errors.push({ uid: ev.uid, message: `Update failed: ${updErr.message}` });
    } else {
      counts.updated += 1;
    }
  }

  return counts;
}
```

### Task 5.2: Write the sync API route

- [ ] **Step 1:** Create `app/api/sync/sports-connect/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAndParseIcal } from '@/lib/ical/parser';
import { ingestEvents } from '@/lib/ical/ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const icalUrl = process.env.SPORTS_CONNECT_ICAL_URL;
  if (!icalUrl) {
    return NextResponse.json(
      { error: 'SPORTS_CONNECT_ICAL_URL is not set' },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', 'tjybb')
    .single();
  if (orgErr || !org) {
    return NextResponse.json(
      { error: `org lookup failed: ${orgErr?.message ?? 'not found'}` },
      { status: 500 }
    );
  }

  const { data: run, error: runErr } = await supabase
    .from('sync_runs')
    .insert({ source: 'sports_connect', status: 'running' })
    .select()
    .single();
  if (runErr || !run) {
    return NextResponse.json(
      { error: `sync_runs insert failed: ${runErr?.message}` },
      { status: 500 }
    );
  }

  try {
    const events = await fetchAndParseIcal(icalUrl);
    const counts = await ingestEvents(supabase, org.id, events);
    const status = counts.errors.length === 0 ? 'success' : 'partial';
    await supabase
      .from('sync_runs')
      .update({
        ended_at: new Date().toISOString(),
        events_seen: counts.seen,
        events_inserted: counts.inserted,
        events_updated: counts.updated,
        events_unchanged: counts.unchanged,
        errors: counts.errors.length ? counts.errors : null,
        status,
      })
      .eq('id', run.id);
    return NextResponse.json({ run_id: run.id, ...counts, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('sync_runs')
      .update({
        ended_at: new Date().toISOString(),
        errors: [{ uid: null, message }],
        status: 'failed',
      })
      .eq('id', run.id);
    return NextResponse.json(
      { error: message, run_id: run.id },
      { status: 500 }
    );
  }
}
```

### Task 5.3: Register the Vercel Cron

- [ ] **Step 1:** Create `vercel.json`

```json
{
  "crons": [
    { "path": "/api/sync/sports-connect", "schedule": "15 * * * *" }
  ]
}
```

Note: Vercel Cron sends a `GET` to the path by default, but also supports POST via the `crons` config. The Vercel docs have gone back and forth on method — if the first cron run logs a 405, switch the route to `GET` (same body) or add a handler that accepts both. Test this in Phase 9.

- [ ] **Step 2:** Add a `POST` alias that also accepts `GET` (Vercel Cron v2 sends GET) — update `app/api/sync/sports-connect/route.ts` to export both:

```typescript
export async function GET(req: Request) {
  return POST(req);
}
```

(Add this line at the very bottom of the file after the `POST` function.)

- [ ] **Step 3:** Commit

```bash
git add app/api/ lib/ical/ingest.ts vercel.json
git commit -m "feat(sync): Sports Connect iCal ingestor + /api/sync/sports-connect route + cron"
git push
```

---

## Phase 6 — Auth (login, callback, middleware)

### Task 6.1: Login page

- [ ] **Step 1:** Create `app/(auth)/login/page.tsx`

```typescript
'use client';

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
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">PYL Field Manager</h1>
        <p className="text-sm text-neutral-600">Sign in to continue.</p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full border rounded px-3 py-2"
          disabled={status === 'sending' || status === 'sent'}
        />
        <button
          type="submit"
          disabled={status === 'sending' || status === 'sent'}
          className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
        </button>
        {status === 'sent' && (
          <p className="text-sm text-green-700">
            Check your email for the sign-in link.
          </p>
        )}
        {status === 'error' && (
          <p className="text-sm text-red-700">{errorMessage}</p>
        )}
      </form>
    </main>
  );
}
```

### Task 6.2: Auth callback route

- [ ] **Step 1:** Create `app/(auth)/auth/callback/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = await createClient();
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(exchangeErr.message)}`, url.origin)
    );
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user?.email) {
    return NextResponse.redirect(new URL('/login?error=no_user', url.origin));
  }

  const { data: coach } = await supabase
    .from('coaches')
    .select('id, role, auth_user_id')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();

  if (!coach) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL('/login?error=not_registered', url.origin)
    );
  }

  if (!coach.auth_user_id) {
    await supabase
      .from('coaches')
      .update({ auth_user_id: user.id })
      .eq('id', coach.id);
  }

  const dest = coach.role === 'admin' ? '/admin' : '/coach';
  return NextResponse.redirect(new URL(dest, url.origin));
}
```

### Task 6.3: Middleware — route guards + session refresh

- [ ] **Step 1:** Create `middleware.ts` at project root

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = req.nextUrl.pathname;
  const protectedPrefixes = ['/admin', '/coach'];
  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));

  if (isProtected && !user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith('/admin') && user) {
    const { data: coach } = await supabase
      .from('coaches')
      .select('role')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (coach?.role !== 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = '/coach';
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ['/admin/:path*', '/coach/:path*'],
};
```

### Task 6.4: Landing page redirect

- [ ] **Step 1:** Replace `app/page.tsx` (create-next-app default) with a redirector

```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: coach } = await supabase
    .from('coaches')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  redirect(coach?.role === 'admin' ? '/admin' : '/coach');
}
```

- [ ] **Step 2:** Commit

```bash
git add app/ middleware.ts
git commit -m "feat(auth): magic-link login + callback + role-based redirect + middleware guards"
git push
```

---

## Phase 7 — Admin page + coach placeholder

### Task 7.1: Admin layout (logout + header)

- [ ] **Step 1:** Create `app/admin/layout.tsx`

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
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <h1 className="text-lg font-semibold">PYL Field Manager — TJYBB</h1>
        <form action={signOut}>
          <button className="text-sm underline">Sign out</button>
        </form>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

### Task 7.2: Admin page — sync history + blocks table + Sync now button

- [ ] **Step 1:** Create a server action for "Sync now" and the admin page. Create `app/admin/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

async function triggerSync() {
  'use server';
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET not set');
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  await fetch(`${base}/api/sync/sports-connect`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    cache: 'no-store',
  });
  revalidatePath('/admin');
}

export default async function AdminPage() {
  const supabase = await createClient();

  const twoWeeksOut = new Date();
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  const [runsRes, blocksRes, fieldsRes] = await Promise.all([
    supabase
      .from('sync_runs')
      .select('*')
      .eq('source', 'sports_connect')
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('schedule_blocks')
      .select('*')
      .gte('start_at', new Date().toISOString())
      .lte('start_at', twoWeeksOut.toISOString())
      .order('start_at', { ascending: true })
      .limit(200),
    supabase.from('fields').select('id, short_name, name'),
  ]);

  const fieldName = new Map(
    (fieldsRes.data ?? []).map((f) => [f.id, f.short_name ?? f.name])
  );

  return (
    <div className="space-y-8">
      <section className="rounded border bg-white p-4">
        <form action={triggerSync}>
          <button className="rounded bg-black px-4 py-2 text-sm text-white">
            Sync now
          </button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Manually triggers the same endpoint Vercel Cron hits every hour at :15.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Recent sync runs
        </h2>
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="p-2">Started</th>
                <th className="p-2">Status</th>
                <th className="p-2">Seen</th>
                <th className="p-2">Inserted</th>
                <th className="p-2">Updated</th>
                <th className="p-2">Errors</th>
              </tr>
            </thead>
            <tbody>
              {(runsRes.data ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">
                    {formatInTimeZone(new Date(r.started_at), TZ, 'yyyy-MM-dd HH:mm')}
                  </td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.events_seen}</td>
                  <td className="p-2">{r.events_inserted}</td>
                  <td className="p-2">{r.events_updated}</td>
                  <td className="p-2">{r.errors ? JSON.stringify(r.errors).slice(0, 80) : '—'}</td>
                </tr>
              ))}
              {(runsRes.data ?? []).length === 0 && (
                <tr>
                  <td className="p-3 text-neutral-500" colSpan={6}>
                    No runs yet. Click "Sync now" above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Next 14 days — schedule blocks
        </h2>
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Time (ET)</th>
                <th className="p-2">Field</th>
                <th className="p-2">Source</th>
                <th className="p-2">Teams / Notes</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(blocksRes.data ?? []).map((b) => {
                const start = new Date(b.start_at);
                const end = new Date(b.end_at);
                const teams =
                  b.away_team_raw && b.home_team_raw
                    ? `${b.away_team_raw} @ ${b.home_team_raw}`
                    : b.notes ?? '—';
                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-2">{formatInTimeZone(start, TZ, 'EEE MMM d')}</td>
                    <td className="p-2">
                      {formatInTimeZone(start, TZ, 'h:mm a')} –{' '}
                      {formatInTimeZone(end, TZ, 'h:mm a')}
                    </td>
                    <td className="p-2">{fieldName.get(b.field_id) ?? b.field_id}</td>
                    <td className="p-2">{b.source}</td>
                    <td className="p-2">{teams}</td>
                    <td className="p-2">{b.status}</td>
                  </tr>
                );
              })}
              {(blocksRes.data ?? []).length === 0 && (
                <tr>
                  <td className="p-3 text-neutral-500" colSpan={6}>
                    No blocks in the next 14 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

### Task 7.3: Coach placeholder page

- [ ] **Step 1:** Create `app/coach/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function CoachPage() {
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
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">Coach portal</h1>
        <p className="text-sm text-neutral-600">
          You're signed in. The coach view lands in Session 4 — for now, this
          page just confirms auth works for non-admin users.
        </p>
        <form action={signOut}>
          <button className="text-sm underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 2:** Commit

```bash
git add app/
git commit -m "feat(admin): sync-now button, sync history, next-14-days blocks; coach placeholder"
git push
```

---

## Phase 8 — Local verification

### Task 8.1: Run and smoke-test locally

- [ ] **Step 1:** Start the dev server

```bash
npm run dev
```

- [ ] **Step 2:** In Supabase Dashboard → **Authentication → URL Configuration**:
  - Site URL: `http://localhost:3000`
  - Redirect URLs: add `http://localhost:3000/auth/callback`
  - Save

- [ ] **Step 3:** Visit `http://localhost:3000` → should redirect to `/login`.

- [ ] **Step 4:** Enter `meesh@poweryourleague.com` → submit. Check email, click the magic link → should land on `/admin`.

- [ ] **Step 5:** On `/admin`, click **Sync now**. Refresh. Verify:
  - A row in the "Recent sync runs" table with status `success` or `partial`
  - Several rows appear in the "Next 14 days" table with source `sports_connect`
  - Times are in Eastern (e.g., `6:00 PM` not `22:00` UTC)

- [ ] **Step 6:** Add a test non-admin coach in the Supabase SQL Editor:

```sql
insert into coaches (org_id, team_id, name, email, role)
  select o.id, t.id, 'Test Coach', 'testcoach+pyl@example.com', 'coach'
  from organizations o, teams t
  where o.slug = 'tjybb' and t.name = '9U B Jaguars — Mitko';
```

Sign in as `testcoach+pyl@example.com` (or another mailbox you control — update the seed SQL first if needed) and verify it lands on `/coach`, and that visiting `/admin` redirects it back to `/coach`.

- [ ] **Step 7:** RLS smoke test: in the Supabase SQL Editor, impersonate that coach (settings gear → "impersonate user" if available, or test from the authed UI) and confirm a `select * from schedule_blocks` returns all blocks (per policy) but `select * from slot_requests` only returns rows where `requester_coach_id` matches them.

### Task 8.2: Fix any issues before deploying

- [ ] **Step 1:** If sync fails: check the `sync_runs.errors` jsonb, and the terminal running `npm run dev`. Common issues:
  - `SPORTS_CONNECT_ICAL_URL` missing or `webcal://` scheme
  - Service-role key pasted into the anon slot (RLS blocks service operations)
  - `DESCRIPTION` mismatch — verify `fields.sports_connect_description` matches exactly (including spaces and `(Huber)`)
- [ ] **Step 2:** If magic-link lands on `/login?error=not_registered`: the email in the auth user is case-sensitive vs. the `coaches.email`. We lowercase during lookup — confirm the DB row is lowercase.

---

## Phase 9 — Deploy

### Task 9.1: Install Vercel CLI and link

- [ ] **Step 1:** Install globally

```bash
npm install -g vercel
```

- [ ] **Step 2:** Link the project (interactive — Meesh logs in and picks team/project name `pyl-field-manager`)

```bash
vercel link
```

### Task 9.2: Set production env vars

- [ ] **Step 1:** Run each command and paste the value when prompted, selecting "Production, Preview, Development" for each:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SPORTS_CONNECT_ICAL_URL
vercel env add CRON_SECRET
vercel env add ADMIN_EMAIL
vercel env add NEXT_PUBLIC_SITE_URL
```

For `NEXT_PUBLIC_SITE_URL` in production, use `https://fields.poweryourleague.com` (even before DNS — it's what the `/admin` Sync Now button will use as the base URL when run from production).

### Task 9.3: First deploy

- [ ] **Step 1:** Deploy to preview, then promote to prod

```bash
vercel
vercel --prod
```

- [ ] **Step 2:** Note the production URL (default is `pyl-field-manager.vercel.app`).

### Task 9.4: Add the magic-link callback URL in Supabase for production

- [ ] **Step 1:** In Supabase Dashboard → **Authentication → URL Configuration**:
  - Add `https://pyl-field-manager.vercel.app/auth/callback` to Redirect URLs
  - Add `https://fields.poweryourleague.com/auth/callback` to Redirect URLs
  - Keep `http://localhost:3000/auth/callback` so local still works
  - Save

### Task 9.5: Smoke-test production

- [ ] **Step 1:** Visit `pyl-field-manager.vercel.app` → log in with magic link → reach `/admin`.
- [ ] **Step 2:** Click Sync now → verify a new row in sync runs.
- [ ] **Step 3:** In Vercel Dashboard → Project → **Settings → Cron Jobs**: confirm `/api/sync/sports-connect` is listed with schedule `15 * * * *`.

### Task 9.6: Configure custom domain — interactive step with Meesh

- [ ] **Step 1:** In Vercel Dashboard → Project → **Settings → Domains**:
  - Add `fields.poweryourleague.com`
  - Vercel will show a CNAME target (e.g., `cname.vercel-dns.com`)
- [ ] **Step 2:** In the registrar that controls `poweryourleague.com` DNS, add a CNAME record:
  - Host: `fields`
  - Value: `cname.vercel-dns.com` (exactly what Vercel showed)
  - TTL: default
- [ ] **Step 3:** Wait 1–15 minutes, refresh Vercel's domain page; it will auto-detect and issue an SSL cert.
- [ ] **Step 4:** Visit `https://fields.poweryourleague.com` → confirm magic link → `/admin` works.

---

## Phase 10 — Code review + polish + handoff

### Task 10.1: `code-review` plugin on the expensive-to-fix code

- [ ] **Step 1:** Invoke `code-review` against:
  - `supabase/migrations/0001_initial_schema.sql`
  - `supabase/seed.sql`
  - `lib/ical/parser.ts`, `lib/ical/ingest.ts`
  - `app/api/sync/sports-connect/route.ts`
  - `app/(auth)/auth/callback/route.ts`
  - `middleware.ts`

Resolve any high-priority findings; defer low-priority to BACKLOG.

### Task 10.2: `code-simplifier` on the whole project

- [ ] **Step 1:** Invoke `code-simplifier` on changed files. Accept only changes that improve clarity (per AGENTS.md rules — brevity is not the goal).

### Task 10.3: Write the handoff

- [ ] **Step 1:** Edit the `## Handoff` section in `docs/sessions/SESSION_1_foundation.md`. Fill in:
  - **What works:** bulleted list tied to the verification checklist
  - **What doesn't:** any deferred items or known bugs
  - **Env vars Meesh needs to set in Vercel:** list the 7 env vars added in Task 9.2
  - **Manual steps Meesh must do:** Supabase URL config, DNS CNAME, any coach rows to add via SQL for Session 4 prep
  - **Next session blockers:** what Session 2 needs that isn't already in place

- [ ] **Step 2:** Tick the verification checklist items at the top of the session doc.

- [ ] **Step 3:** Final commit + push

```bash
git add docs/
git commit -m "docs(session-1): handoff notes and verification checklist complete"
git push
```

---

## Self-review checklist

- **Spec coverage:**
  - Project scaffold: Phase 1 ✅
  - DB schema + seed: Phase 2 ✅
  - Supabase clients (3): Phase 3 ✅
  - iCal parser (tested): Phase 4 ✅
  - iCal ingestor + sync route + Vercel cron: Phase 5 ✅
  - Auth (login, callback, middleware, role redirect): Phase 6 ✅
  - Admin page (sync button, history, blocks table) + coach placeholder: Phase 7 ✅
  - Local verification against brief's checklist: Phase 8 ✅
  - Vercel deploy + env vars + cron + DNS: Phase 9 ✅
  - Code review + handoff: Phase 10 ✅

- **Placeholders:** none remaining — every step has explicit commands, code, or SQL.

- **Type consistency:** `NormalizedEvent` in `lib/types.ts` (Task 3.4) matches the return shape of `parseIcal` (Task 4.4) and the input shape of `ingestEvents` (Task 5.1).

- **Spec gaps:** travel-slot materialization was explicitly deferred to Session 2 (confirmed in Phase 1 chat). Open-slot materialization is handled in the seed (Task 2.3) for 4 weeks.
