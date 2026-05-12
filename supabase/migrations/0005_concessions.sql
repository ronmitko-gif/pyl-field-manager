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

create policy "public read events" on concession_events for select using (true);
create policy "public read slots"  on concession_slots  for select using (true);
create policy "public read active signups" on concession_signups
  for select using (cancelled_at is null);
create policy "admin full access events"  on concession_events for all using (is_admin());
create policy "admin full access slots"   on concession_slots  for all using (is_admin());
create policy "admin full access signups" on concession_signups for all using (is_admin());
