-- Optional display name for a concession event (e.g. "Memorial Day Classic").
-- Nullable: existing/auto-generated game days keep showing date + type when null.
alter table concession_events add column name text;
