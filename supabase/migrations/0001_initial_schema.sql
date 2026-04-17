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
