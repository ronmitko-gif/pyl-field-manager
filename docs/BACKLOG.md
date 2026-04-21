# Backlog

Ideas that came up mid-session but aren't in a session brief. Each line: one-sentence rationale. Graduate to a session brief when prioritized.

---

## Session 4 design notes (pre-decided)

- **Open slots = windows, not pre-seeded blocks.** Drop the `source='open_slot'` seeding from `supabase/seed.sql`. Instead, introduce an `open_windows` config table keyed by `(org_id, day_of_week, start_time, end_time)` and materialize a `schedule_blocks` row only when a coach's slot request is approved. Coach request form asks for a start time + duration within the window. This replaces the current "pick one of 4 fixed 2-hour slots" UX with "pick 2-4pm exactly." Discussed 2026-04-21.

## Deferred from earlier sessions

- **Delete for coaches and fields** — Session 3 shipped add/edit only. Cascade design needed before delete: schedule_blocks FK + slot_requests FK. Probably soft-delete is the right answer.
- **CSV upload fallback for Sports Connect** — originally planned for Session 3; deferred because iCal hasn't broken. Revisit if the feed ever fails for >1 hour.
