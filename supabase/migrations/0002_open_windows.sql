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
