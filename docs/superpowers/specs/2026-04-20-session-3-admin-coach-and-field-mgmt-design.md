# Session 3 — Admin UI: coaches + field mapping (Design)

**Date:** 2026-04-20
**Status:** Design approved; ready for implementation plan.
**Roadmap slot:** Session 3 per `SCOPE.md §9`.

---

## Goal

Unblock Session 4 (coach portal) by letting Meesh add real coaches through the admin UI, and give him a one-click path to fix Sports Connect DESCRIPTIONs that don't match the seeded field names.

## Non-goals

- CSV upload fallback — deferred to BACKLOG (iCal hasn't broken; can revisit if it does)
- Creating new physical fields — the two fields never change; no admin "Add field" form
- Deleting coaches or fields — BACKLOG (needs cascade design for FK'd schedule_blocks / slot_requests)
- Bulk operations — YAGNI
- Coach auth management (resetting `auth_user_id`, etc.) — not needed since magic-link flow self-heals

---

## Units

### Unit 1 — Coach management (full add + edit)

**Routes:**
- `/admin/coaches` — list all coaches for the org
- `/admin/coaches/new` — form to add a coach
- `/admin/coaches/[id]` — form to edit a coach

**List page:**
- Table columns: Name, Email, Role, Team, Phone
- "Add coach" button top-right → `/admin/coaches/new`
- Each row clickable → edit page
- Sorted: admins first, then coaches alphabetical by team

**Form fields (shared between new + edit):**

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | text | yes | Free-form, e.g., "Chris Hennessy" |
| Email | email | yes | Lowercased on save, unique (DB constraint enforces) |
| Role | select | yes | `admin` or `coach`; defaults to `coach` |
| Team | select | no | "None" or one of the travel teams from `teams` table; admin role usually "None" |
| Phone | tel | no | Free-form; E.164 suggested but not enforced (trim + basic `+` prefix check only) |

On save (new): insert into `coaches` with `org_id` from the tjybb lookup. `auth_user_id` left NULL — populated on first magic-link login (existing flow in `/auth/callback`).

On save (edit): update the row. Re-assigning a team updates the `team_id` FK. Cannot edit `email` if `auth_user_id` is already set (would break the tie to Supabase auth) — form disables the field and shows a note.

**Edge cases:**
- Duplicate email on create → DB raises unique-constraint error → server action catches it → form shows "A coach with that email already exists."
- Role changed from `coach` to `admin` → next login picks up new role via the middleware check. No re-login required. Note explaining this on the form.

### Unit 2 — Field edit (no add, no delete)

**Route:** `/admin/fields`

**Page layout:**
- Simple list: both fields shown as cards (stacked vertically)
- Each card has inline-editable fields:
  - Sports Connect description (text input)
  - Has lights (checkbox)
  - Notes (textarea)
- "Save" button per card; independent save actions
- `name`, `short_name`, `park` are read-only (displayed but not editable — these came from the seed and don't change)

**Error flash:** if the URL has `?unmapped=<encoded-description>`, show a banner at the top:

> ⚠ Recent sync found an unmapped DESCRIPTION:
> **`Reilly Park > Something Not Seeded`**
> Paste this into the Sports Connect description of the right field below, then Save.

That banner goes away when the user navigates away.

### Unit 3 — Error recovery in sync-runs table

**Modify:** `app/admin/page.tsx` — the existing sync-runs table

When a sync run has `errors` column populated, parse the JSON and for each error that looks like `No field match for DESCRIPTION="..."`, show the DESCRIPTION in a new column with a **Fix** button:

```
[Fix →] Unmapped: "Reilly Park > Foo Field"
```

The button is a `<Link>` to `/admin/fields?unmapped=<encoded>`. Clicking it takes admin to the field-edit page with the banner pre-populated.

### Unit 4 — Admin secondary nav

Add a thin navbar **below** the existing `<header>` in `app/admin/layout.tsx`. Links:

- Dashboard (`/admin`)
- Coaches (`/admin/coaches`)
- Fields (`/admin/fields`)

Active link gets `underline underline-offset-4 decoration-tj-gold`. This is server-rendered (no client state) — uses `headers()` to read the current pathname if needed, or just accepts the pathname as a prop from a thin client wrapper.

---

## Data model

No schema changes. All columns exist:

- `coaches` has `name`, `email`, `role`, `team_id`, `phone`, `org_id`, `auth_user_id`, `created_at`
- `fields` has `sports_connect_description`, `has_lights`, `notes`, plus the read-only `name`, `short_name`, `park`
- `sync_runs.errors` is already `jsonb` and already populated by the ingestor

---

## Server actions (new entries in `app/admin/_actions.ts`)

```typescript
export async function createCoach(formData: FormData): Promise<void>
export async function updateCoach(formData: FormData): Promise<void>
export async function updateField(formData: FormData): Promise<void>
```

All three use the **admin client** (`createAdminClient`) — they are admin-scoped writes, and RLS on `coaches` blocks cross-row visibility for the authed user. Each action validates the caller is an admin by looking up `coaches` by `auth_user_id` and checking `role='admin'` before performing the write.

Each action revalidates the relevant paths (`/admin/coaches` etc.) and redirects back to the list on success.

---

## Auth + authorization

- All `/admin/*` routes are already protected by `proxy.ts` (requires auth, redirects non-admins to `/coach`).
- Server actions also do an explicit admin-role check (defense in depth — in case a coach finds the action's internal endpoint). If not admin, `throw new Error('unauthorized')`.

---

## UI consistency

- TJ palette tokens (black + Steelers gold + cream) already loaded from Session 2.
- Forms match the drawer's styling: `rounded border border-tj-black/20 px-2 py-1 text-sm`.
- Primary action button: `bg-tj-black text-tj-cream`. Secondary: `border border-tj-black/20`.
- Danger-ish "unsaved changes" banner uses `bg-tj-gold-soft`.

---

## Testing

No new unit tests (this is CRUD form code, best verified manually). Existing Session 1–2 tests stay green.

**Manual QA:**

1. Create a new coach with a valid email and team → log in as that coach via magic link → lands on `/coach` placeholder. Pass.
2. Create a coach with an email that already exists → see the form error. Pass.
3. Edit an existing coach's phone → save → see it persisted in the list. Pass.
4. Visit `/admin/fields` → edit `sports_connect_description` of 885 Back → save → click "Sync rec" on dashboard → verify sync picks up the new match.
5. Simulate an unmapped description (e.g., temporarily rename an SC description in the DB) → run sync → check the error shows "Fix" link → click it → verify banner renders at `/admin/fields`.

---

## Open questions

None — scope is tight, no external dependencies, no new env vars.

---

## Exit criteria

- [ ] Admin can add a coach via `/admin/coaches/new`, see them in the list, and they can log in via magic link.
- [ ] Admin can edit a coach's role, team, phone, or name.
- [ ] Admin cannot edit an existing coach's email when `auth_user_id` is set.
- [ ] Admin can edit a field's `sports_connect_description`, `has_lights`, and `notes`.
- [ ] Sync-runs table surfaces unmapped DESCRIPTIONs with a working "Fix" link.
- [ ] Secondary admin nav renders on all `/admin/*` pages with active link highlighting.
- [ ] All TypeScript type-checks and builds clean on Vercel.
