# Session 6 — Public View + Polish (Design)

**Date:** 2026-04-22
**Status:** Design approved; ready for implementation plan.
**Roadmap slot:** Session 6 per `SCOPE.md §9` (polish + first real users).

---

## Goal

Ship a public read-only schedule page anyone can bookmark, fix five specific polish items that will bite real users, and leave the product in a state where Meesh can invite 1–2 travel coaches to actually use it.

## Non-goals

- Applying the `poweryourleague-brand` skill — we're staying on TJ black + gold; PYL skin comes post-PYL-port (see `BACKLOG.md`)
- Loading spinners on every button
- Deep mobile redesign
- Parent-specific features beyond the public schedule (notifications for parents, etc. — not in scope for v1)

---

## Decisions made during brainstorming

- **Public view URL is `/schedule`** — single-tenant for now. Multi-tenant (`/p/<slug>`) waits until we actually have multiple orgs.
- **Public view reuses `WeekGrid`** via a new `readonly` prop, not a fork. One source of truth for the grid.
- **Cursor fix is global CSS**, not per-button Tailwind class. Tailwind v4 removed the default `cursor-pointer` on buttons; a single `@layer` rule reinstates it app-wide.

---

## Units

### Unit 1 — Global cursor fix

**File:** `app/globals.css`

Add at the bottom:

```css
button:not(:disabled),
[role="button"] {
  cursor: pointer;
}
```

That's it. Every button in the app gets pointer-on-hover. Disabled buttons stay as default (arrow), matching web conventions.

### Unit 2 — Public schedule view

**Route:** `app/schedule/page.tsx`

- Server component, no auth (middleware's `matcher` already excludes `/schedule`).
- Header: black bar matching admin/coach, TJ-gold "Field Schedule" title + subline "Thomas Jefferson Youth Baseball · Andrew Reilly Memorial Park".
- `WeekNav` (reused) for prev/next/today navigation via `?week=` query param.
- `WeekGrid` (extended with `readonly={true}` — see Unit 3).
- `DayList` on mobile (<768px) same as admin, but with a readonly variant (`clickable={false}`).
- No drawer, no forms, no admin buttons.
- Footer: small "Last synced: <relative time>" based on most recent sync_runs row.
- Data query: all `schedule_blocks` in the week window where `status != 'cancelled'`.
- **Privacy pass:** the page does NOT show coach names, phones, or emails. It only shows team names (already public), field names, times, and rec matchups from `home_team_raw`/`away_team_raw`.

### Unit 3 — `WeekGrid` + `BlockCard` + `DayList` readonly variants

Three components gain a `readonly` prop. When `true`:

- **`BlockCard`:** renders as a plain `<div>` instead of a `<Link>` (no click target, no drawer navigation). Same colors + labels.
- **`WeekGrid`:** passes `readonly` through to each `FieldGrid` → `BlockCard`.
- **`DayList`:** renders each block as a plain `<div>` instead of a `<Link>`.

Default behavior (`readonly` omitted or `false`) is unchanged — all existing callers work.

### Unit 4 — Login page polish

**File:** `app/(auth)/login/page.tsx` — modify.

- Add a top header bar matching admin/coach: black bg, gold "PYL" accent, "Field Manager — TJYBB".
- Main form area becomes a card (white bg, bordered) centered in the viewport.
- Below the form, add `<Link href="/schedule" className="text-sm underline">View public schedule →</Link>`.
- Keep the form inputs and logic unchanged.

### Unit 5 — Coach portal empty states

**File:** `app/coach/page.tsx` — modify the three empty-state messages.

| Section | Before | After |
|---|---|---|
| No upcoming blocks | "No upcoming practices. Request a slot below." | "No upcoming practices. Check the open windows below, then request a slot." |
| No pending requests | "No pending requests." | "No pending requests — submit one above." |
| (new) No team assigned | (silent null-team) | Yellow banner at the top: "You're not assigned to a team yet. Contact the admin to fix." + disabled request form. |

The null-team case previously would have let a coach submit a request with `team_id=null`, which the server action already rejects (`if (!coach.team_id) throw new Error('You must be assigned to a team.')`). The banner makes the failure mode clear.

### Unit 6 — Admin nav horizontal scroll on mobile

**File:** `app/admin/_components/admin-nav.tsx` — modify.

- Add `overflow-x-auto whitespace-nowrap` to the `<nav>` classes.
- Links stay on a single row; narrow viewports scroll horizontally instead of wrapping.

---

## Data model

No schema changes, no migrations.

---

## Testing

No new unit tests (this is presentational polish + a server-rendered route with no logic worth isolating).

**Manual QA:**

1. Visit `/schedule` in an incognito window → week grid renders with this week's blocks, no login required.
2. Prev/next/today navigation works; URL updates with `?week=...`.
3. Resize to <768px on `/schedule` → grid collapses to day list.
4. Hover any button in the app → cursor becomes pointer.
5. Hover a disabled button (e.g., coach Request form with required fields missing) → cursor stays default.
6. Visit `/login` → TJ-branded header + "View public schedule" link.
7. Log in as a coach whose `team_id` is null → see the yellow "not assigned" banner; request form absent/disabled.
8. Admin on a narrow viewport → secondary nav scrolls horizontally, all 5 links visible via scroll.

---

## Exit criteria

- [ ] `/schedule` renders publicly without authentication
- [ ] All buttons show pointer cursor on hover; disabled ones don't
- [ ] Login page has the TJ-branded header + public link
- [ ] Coach empty states updated
- [ ] Admin nav scrolls horizontally on narrow widths
- [ ] All existing admin + coach functionality still works (regression check)
- [ ] Build + type-check pass on Vercel

---

## Open questions

None — scope is concrete, single-tenant assumption locked in, no external dependencies.
