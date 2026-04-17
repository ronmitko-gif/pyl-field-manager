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
         ((d.day + w.start_time) at time zone 'America/New_York') as start_at,
         ((d.day + w.start_time + interval '2 hours') at time zone 'America/New_York') as end_at,
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
