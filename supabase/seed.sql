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

-- Open windows (Session 4): 885 Back Field
-- Fri 8-10pm, Sat 11am-7pm, Sun 9am-7pm
insert into open_windows (org_id, field_id, day_of_week, start_time, end_time)
  select o.id, f.id, v.dow, v.start_t, v.end_t
  from organizations o
  join fields f on f.org_id = o.id and f.name = '885 Back Field',
    (values
      (5, '20:00'::time, '22:00'::time),
      (6, '09:00'::time, '19:00'::time),
      (0, '09:00'::time, '19:00'::time)
    ) as v(dow, start_t, end_t)
  where o.slug = 'tjybb'
    and not exists (
      select 1 from open_windows w
      where w.org_id = o.id
        and w.field_id = f.id
        and w.day_of_week = v.dow
        and w.start_time = v.start_t
    );
