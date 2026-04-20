# Session 2 — Calendar + Travel Materialization + Block Detail (Design)

**Date:** 2026-04-20
**Status:** Design approved; ready for implementation plan.
**Roadmap slot:** Session 2 per `SCOPE.md §9`.

---

## Goal

Turn the bare-bones admin table from Session 1 into a usable field-scheduling dashboard:

1. A week calendar grid showing every block, color-coded by source
2. A travel-slot materialization job that turns the 5 `travel_recurring_slots` rows into 8 weeks of concrete `schedule_blocks`
3. A block-detail panel that lets Meesh change status and notes without touching SQL

All of it styled with the `poweryourleague-brand` skill's tokens so Session 2 screens look like PYL from day one.

## Non-goals

- Coach portal, per-team filter views — Session 4
- Slot request / approval flow — Session 4
- Rec-override-travel flow — Session 5
- Twilio SMS — Session 5
- Time-editing or team-reassignment on a block — deferred
- Creating a manual block from scratch in the UI — deferred (Session 3)
- Public / parent view — post-test

---

## Units

### Unit 1 — Travel slot materialization

**What it does:** Expands the 5 recurring travel slot definitions into concrete dated blocks for the next 8 weeks.

**Why 8 weeks?** Open slots materialize at 4 weeks (Session 1); travel needs a longer lookahead because practices are predictable and coaches plan further out. 8 weeks balances lookahead with re-materialization frequency.

**Endpoint:** `POST /api/sync/travel-slots`

- Same auth as sports-connect sync: `Authorization: Bearer ${CRON_SECRET}`
- Same response shape (`sync_runs` row + JSON summary with inserted/updated/unchanged counts)
- Uses `source='sports_connect'`-style upsert pattern but on a composite natural key

**Upsert key:** `(source, source_uid)` — the unique index from migration 0001 already covers this. `source_uid` is a synthetic composite `travel:<recurring_slot_id>:<iso_date>` (e.g., `travel:a1b2c3:2026-04-21`). This key lets the materializer upsert idempotently and also makes it cheap to find and delete stale rows when a recurring slot's `effective_to` gets shortened.

**Algorithm:**

1. Load all `travel_recurring_slots` rows.
2. For each, compute every date between `max(effective_from, today)` and `min(effective_to, today+56 days)` where `day_of_week` matches.
3. For each date, compute `start_at` and `end_at` in UTC by combining the date + `start_time`/`end_time` at America/New_York and converting.
4. Upsert a `schedule_blocks` row: `source='travel_recurring'`, `team_id`, `field_id`, computed times, `status='confirmed'`, `source_uid='travel:<slot_id>:<date>'`.
5. If an existing row's times or team have changed (edited slot definition), update. If `effective_to` passed, DELETE future `travel_recurring` rows beyond that date.

**Triggers:**

- Hourly GitHub Actions workflow: add a second step after the Sports Connect POST that POSTs to `/api/sync/travel-slots`. Same CRON_SECRET.
- Admin UI: a "Sync travel" button (next to the existing "Sync now" rec button). Same server-action pattern.

**Edge cases:**

- A recurring slot's `effective_to` gets set: future `travel_recurring` blocks past that date should be deleted. Handle in the same job.
- A recurring slot's time or team is edited: next run updates the affected future rows in-place (keyed on `source_uid`).
- A block was manually edited (e.g., status=`cancelled` by admin) and the materializer would otherwise recreate it: the materializer only inserts-or-updates, it doesn't touch `status`, so admin edits stick. (Implication: when we delete a recurring slot, we should also leave `cancelled` blocks alone — nuance to call out in the plan.)

### Unit 2 — Calendar week grid

**What it does:** Shows every block for the current week on two stacked grids (885 Back on top, 885 Front below), with week navigation and a mobile fallback.

**Layout:**

- Two week grids stacked vertically. Each grid has a field heading.
- Columns: Mon, Tue, Wed, Thu, Fri, Sat, Sun.
- Rows: hourly 6:00 AM – 11:00 PM (17 rows). Times in America/New_York.
- Blocks absolutely positioned inside each day column. Top/height computed from `start_at`/`end_at`: `top = (hours_past_6am * row_height_px)`, `height = (duration_hours * row_height_px)`.
- Default view: current week (Mon of today).
- Navigation: `◀ Week of <date> ▶` with prev/next buttons and a "Today" jump button.

**Color coding (source):**

| Source | Palette role |
|---|---|
| `sports_connect` (rec) | Primary blue |
| `travel_recurring` | Brand green |
| `override` | Warning orange |
| `manual` | Neutral purple |
| `open_slot` | Neutral gray, dashed border |

Exact hex values come from the `poweryourleague-brand` skill's tokens (loaded during implementation).

**Status modifier (layered on top of source color):**

- `confirmed` — default (solid)
- `tentative` — 2px dashed border
- `cancelled` — 40% opacity + strikethrough on the block label
- `overridden` — red hatched background pattern (for readability, the block remains but shows it's been reassigned)
- `open` — applies only to `open_slot` source; shows a "Request" call-to-action hint

**Block contents inside each cell:**

- Line 1: team name(s) or "Open slot"
- Line 2: start–end time (`7:00–8:30 PM`)
- Click anywhere on the block opens the detail panel.

**Responsive breakpoint:**

- ≥768px: full two-grid layout described above
- <768px: collapse to a single-day list view; top has Mon–Sun pills; picking a day shows a vertical list of blocks for that day, grouped by field.

**Data loading:**

- Server component on `/admin` fetches blocks for `week_start ± 1 day buffer` (for timezone edge safety) from Supabase using the admin client (for the admin page, RLS is already admin-pass-through — but admin client avoids a per-request role check).
- Week navigation uses URL query params (`?week=2026-W17`) so pages are bookmarkable.

### Unit 3 — Block detail panel + simple edits

**What it does:** Side drawer opens when a block is clicked, shows full block details, lets admin edit status + notes.

**UI:**

- Right-side drawer, slides in over the calendar (on mobile, full-screen).
- Header: source badge (color matches the block) + field name + start→end time.
- Body:
  - Date (in ET)
  - Source (read-only)
  - Teams (read-only; shows `home_team_raw` / `away_team_raw` for rec, or team name for travel)
  - Status (editable dropdown: `confirmed`, `cancelled`, `tentative`; `overridden` and `open` are read-only — set by other flows)
  - Notes (editable textarea)
  - Last updated timestamp
- Footer: "Save" button (primary) + "Cancel"/Close (secondary). Save submits a server action that updates the row and revalidates `/admin`.
- Optimistic UI: drawer closes immediately on Save; any server error shows a toast and reopens the drawer.

**Scope of edits:**

- Status: `confirmed` ↔ `cancelled` ↔ `tentative`. Not allowed: moving a block to `overridden` or `open` from here.
- Notes: free-text, max 500 chars, nullable.

**What's intentionally NOT editable in this session:**

- `start_at` / `end_at` (no conflict-detection logic yet)
- `team_id` (handled via slot-request approval in Session 4)
- `source` (semantic integrity — changing source would invalidate the row's origin)
- `overridden_by_block_id` (handled by override flow in Session 5)

---

## Page composition — final `/admin` layout

```
┌─────────────────────────────────────────────────┐
│ PYL Field Manager — TJYBB              Sign out │
├─────────────────────────────────────────────────┤
│ [Sync rec]  [Sync travel]                       │
├─────────────────────────────────────────────────┤
│ ◀ Week of Apr 20, 2026 ▶    [Today]             │
│                                                  │
│ 885 Back Field                                  │
│   Mon  Tue  Wed  Thu  Fri  Sat  Sun             │
│   [week grid]                                   │
│                                                 │
│ 885 Front Field                                 │
│   [week grid]                                   │
├─────────────────────────────────────────────────┤
│ Next 10 upcoming blocks │ Next 10 open slots    │
│ (compact list)          │ (compact list)        │
├─────────────────────────────────────────────────┤
│ Recent sync runs (sports_connect + travel)      │
└─────────────────────────────────────────────────┘
```

**Detail drawer opens overlaid** when any block in the grid (or either list) is clicked.

---

## Data model changes

**No new migration is required.** The `(source, source_uid)` unique index from migration 0001 already supports the travel upsert pattern. All Unit 3 edits use existing columns (`status`, `notes`, `updated_at`).

---

## Brand styling — TJYBB (Thomas Jefferson Youth Baseball) palette

Since this deployment serves TJYBB users specifically, we use their school colors (black + gold) instead of the generic PYL brand skin. When the Field Manager module lifts into the PYL multi-tenant platform, tokens will become per-tenant configurable — so using TJ's palette here is actually forward-compatible.

**Palette (defined as CSS vars in `app/globals.css`):**

| Token | Value | Use |
|---|---|---|
| `--tj-black` | `#0a0a0a` | Primary text, headers, admin buttons |
| `--tj-gold` | `#c5a34a` | Primary accent (travel team color, sync-button fills, active states) |
| `--tj-gold-soft` | `#e6d08a` | Gold backgrounds, hover states |
| `--tj-cream` | `#fbf7ee` | Page background, card fills |
| `--rec-blue` | `#3b6ea8` | `sports_connect` block color |
| `--override-red` | `#b84545` | `override` block color |
| `--manual-slate` | `#4a5568` | `manual` block color |
| `--open-gray` | `#9ca3af` | `open_slot` border color (dashed) |

**Typography:** Use Tailwind/Next defaults (Geist Sans + Geist Mono) — no custom fonts in Session 2.

**Application points:**

- `app/globals.css` gets a `@theme` block (Tailwind v4 idiom) with these tokens
- Block colors in Unit 2 map to the tokens above
- Admin header, buttons, and list components use `--tj-black` and `--tj-gold`
- Session 1's admin page gets a light restyle pass so the whole surface is consistent.

---

## Testing

**Unit tests (vitest):**

- `lib/travel/materialize.ts` — given a recurring slot and a date range, returns the correct list of concrete blocks (timezone edge cases: DST fall-back, DST spring-forward, effective_to cutoff).

**Manual QA:**

- Trigger "Sync travel" → verify 5 recurring slots × 8 weeks = ~40 travel blocks appear in the grid.
- Re-trigger — counts should be all `unchanged` or `updated`, never duplicates.
- Click a block → drawer opens with correct data. Edit notes → save → drawer closes → notes persist on refresh.
- Change status to `cancelled` → block shows strikethrough + 40% opacity on the grid.
- Mobile (<768px viewport): verify day-list fallback works.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| DST transition misaligns materialized travel blocks | Unit test both transitions; `date-fns-tz` `zonedTimeToUtc` handles correctly if used consistently |
| Admin-edited block gets clobbered by re-materialization | Upsert only touches `start_at`/`end_at`/`team_id`; `status` and `notes` are preserved |
| `poweryourleague-brand` skill tokens conflict with Tailwind v4 defaults | Brand tokens go into CSS vars via `@theme` block in `globals.css`; Tailwind classes reference those vars (v4 idiom) |
| GitHub Actions workflow fires before app is redeployed with new route | First run after deploy is fine; if route returns 404 once, next hour recovers. Not load-bearing. |

---

## Open questions (to resolve during build, not blocking)

- Exact brand token palette values — resolved once `poweryourleague-brand` skill is invoked at implementation time.
- Whether to show overridden blocks alongside the overriding block in the grid (visual crowding vs. history transparency). Default: show the overriding block; the overridden block is dimmed + strikethrough and links to its replacement in the detail panel.

---

## Exit criteria

- [ ] `/admin` shows a week calendar grid with real blocks from both fields
- [ ] Clicking a block opens a detail drawer; editing status or notes persists after refresh
- [ ] `POST /api/sync/travel-slots` materializes 8 weeks of travel blocks; re-running is idempotent
- [ ] GitHub Actions workflow runs both sync endpoints hourly
- [ ] All UI uses `poweryourleague-brand` tokens (no bespoke colors)
- [ ] Mobile viewport shows day-list fallback
- [ ] Vitest suite still green; build passes on Vercel
