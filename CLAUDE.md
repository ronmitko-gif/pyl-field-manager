# CLAUDE.md

This file is the persistent context you (Claude Code) read at the start of every session in this repo. It describes the project, the working style, the technical rules, and the things that commonly trip up new sessions. If you're about to do something that contradicts this file, stop and ask.

---

## Project at a glance

**PYL Field Manager** — a shared field scheduling app for Thomas Jefferson Youth Baseball (TJYBB). Test environment for a feature that will later fold into PowerYourLeague (PYL) as a Pro-tier module.

**Operator:** Meesh (sole developer, also the admin user). One test organization: TJYBB. Five travel teams, one rec division, two fields at one park.

**Full scope and roadmap:** see `SCOPE.md` in the repo root.
**Session-by-session build briefs:** see `docs/sessions/SESSION_N_*.md` as they're created.

---

## Working style

### Committing and pushing
- Commit frequently with descriptive messages. Never batch multiple concerns into one commit.
- Push to GitHub after every major step so Meesh can pull on another machine if needed.
- Branch strategy: work on `main` for now (solo developer). When a session lands something risky, create a short-lived `session-N-wip` branch and merge when verified.

### Session discipline
- Each coding session is scoped by a numbered brief in `docs/sessions/`. Do not wander outside that scope — if something tempting comes up, add it to `docs/BACKLOG.md` and keep moving.
- If a step is taking more than 30 minutes with no progress, stop, summarize the blocker, and ask rather than thrashing.
- End every session by writing a short handoff note: what works, what doesn't, what's needed from Meesh next.

### Asking vs. assuming
- When the brief is ambiguous, ask. Don't guess data shapes, team names, or business rules.
- When a library has multiple reasonable APIs (e.g., two ways to use Supabase auth), pick the one shown in official Next.js + Supabase docs and note the choice in code comments.

### Code review expectations
- Run the `code-review` plugin against any schema migration, any ingestor/sync code, and any auth flow code before committing. These are expensive to get wrong.
- Run `code-simplifier` at the end of each session to catch obvious redundancy.

---

## Technical rules

### Stack (locked)
- **Next.js 15** with App Router, TypeScript strict mode, Tailwind
- **Supabase** for Postgres, Auth (magic links only — no passwords), and RLS
- **Vercel** for hosting and Cron
- **Twilio** for SMS (Session 5+)
- **`node-ical`** for iCal parsing
- **`date-fns` + `date-fns-tz`** for date handling
- **`pnpm`** as package manager (fall back to `npm` if `pnpm` isn't available)

### Stack (forbidden without discussion)
- No state management libraries (no Zustand, Redux, Jotai). React Server Components + Supabase client handle this.
- No ORM other than Supabase's built-in query builder. No Prisma, no Drizzle.
- No date library other than `date-fns`/`date-fns-tz`. No Moment, no Luxon, no Day.js.
- No CSS framework other than Tailwind. No styled-components, no Emotion.
- No authentication library other than Supabase Auth. No NextAuth, no Clerk, no Auth0.
- No UI kit by default. `shadcn/ui` is allowed only when Meesh requests a component — then install one component at a time via the CLI, not the whole kit.

### File organization
- `app/` — Next.js routes only, thin files that import from `lib/`
- `lib/` — all business logic, Supabase clients, parsers, helpers
- `lib/supabase/` — three clients: `client.ts` (browser), `server.ts` (RSC), `admin.ts` (service role, server-only)
- `supabase/migrations/` — numbered SQL files, never edit a migration after it's applied; add a new one
- `supabase/seed.sql` — seed data; idempotent (use `on conflict do nothing` or upserts)
- `docs/` — all markdown docs: `SCOPE.md`, `AGENTS.md`, `BACKLOG.md`, `docs/sessions/`, `docs/runbooks/`

### Environment variables
- All env vars documented in `.env.example` with comments
- Never commit `.env.local` (verify it's in `.gitignore` before first commit)
- Any new env var added in a session must be added to `.env.example` in the same commit
- Server-only secrets (service role key, Twilio auth token, cron secret) must never appear in `NEXT_PUBLIC_*` vars

### Timezones
- Database stores everything in UTC (`timestamptz`)
- UI displays in `America/New_York` by default
- Never do manual offset math; always use `date-fns-tz` `formatInTimeZone` / `zonedTimeToUtc`
- When parsing iCal, `DTSTART` with trailing `Z` is already UTC — don't re-convert

### Database rules
- **Every tenant-scoped table must have `org_id`** — even though there's only one org right now. This is non-negotiable and enables PYL multi-tenancy later without migration.
- **RLS is on by default** — any new table gets `alter table X enable row level security` in the same migration.
- **Foreign keys are required** — every reference to another table must be a proper FK with `on delete` behavior specified.
- **Indexes on query paths** — any column used in a `where` or `order by` in application code must have an index.
- **Migrations are additive** — never edit an applied migration. Add a new numbered file.
- **Seeds are idempotent** — safe to re-run without creating duplicates. Use natural keys and upserts.

### Auth rules
- Magic links only. No passwords, no OAuth, no SSO in v1.
- A user logging in for the first time is looked up by email in the `coaches` table:
  - If found and `auth_user_id` is null → populate it from `auth.uid()`
  - If found and `auth_user_id` already set → normal login
  - If not found → show "Your email isn't registered, contact admin." Do NOT auto-create coach rows.
- Admin role is set manually in the database (via seed or admin UI), never inferred from email domain.

### External integrations
- **Sports Connect iCal URL** — treat as a credential. Stored only in `SPORTS_CONNECT_ICAL_URL` env var. Never logged, never returned in API responses, never committed.
- **Twilio** — when wiring in Session 5, use a test sub-account first. Never hardcode phone numbers; pull from the `coaches` table.
- **All external API calls** — wrap in try/catch, log failures to the `sync_runs` or `notifications` table, surface errors to the admin UI.

---

## Things that commonly go wrong (watch for these)

1. **Supabase RLS blocking the sync job.** The ingestor uses the service role key — verify it's using the `admin` client, not the anon `server` client. If queries suddenly return zero rows, check which client is in use.

2. **`webcal://` vs `https://` in env vars.** Sports Connect gives you a `webcal://` URL but `node-ical` and `fetch` need `https://`. Swap the scheme when loading from env.

3. **iCal UTC handling.** Events from Sports Connect end with `Z` (UTC). Do NOT pass them through a timezone converter assuming they're local. Store the raw UTC, display converted.

4. **Seed data conflicting with live sync.** If you seed rec games and the iCal sync also pulls them, you get duplicates. Solution: never seed `source='sports_connect'` rows. Only seed orgs, fields, teams, coaches, and travel recurring slots.

5. **`DESCRIPTION` field matching.** The iCal `DESCRIPTION` format is `Park Name > Field Name`. Split on ` > ` (with spaces), not `>`. And match `sports_connect_description` exactly — a trailing space will cause silent field mismatches.

6. **Magic link callback URL mismatch.** In Supabase dashboard → Auth → URL Configuration, the Site URL and Redirect URLs must include both `http://localhost:3000` and `https://fields.poweryourleague.com`. Missing either breaks login in that environment.

7. **Vercel Cron secret.** The cron route must verify `Authorization: Bearer ${CRON_SECRET}`. Vercel sends this header automatically when configured; if manual testing returns 401, check the env var is set in Vercel's project settings (not just locally).

8. **Committing `.env.local`.** Always `cat .gitignore | grep env` before first commit. A leaked service role key or iCal token is a bad afternoon.

---

## How to handle "should I build X?" moments

When you encounter a tempting addition mid-session, use this decision tree:

1. Is it in the current session brief's scope? → build it
2. Is it in a future session brief? → don't build it, note it in the handoff
3. Is it a bug fix for something already built? → fix it, note it in the commit
4. Is it a new idea not in any brief? → add it to `docs/BACKLOG.md` with a one-line rationale, move on
5. Is it a rewrite of something already built? → stop and ask Meesh

The goal is predictable, scoped sessions. Surprise features that weren't asked for are rework waiting to happen.

---

## PYL context (why this matters)

This isn't a standalone side project. The whole point of building it here first is to de-risk it before rolling it into PYL. That means every architectural decision should pass this test: **"Will this survive the port to PYL's multi-tenant architecture?"**

- Uses `org_id` from day one? ✅
- RLS policies reference `org_id`? ✅
- Schema is generic (`organizations`, `teams`, `fields`) not TJYBB-specific? ✅
- Business logic lives in `lib/`, not baked into routes? ✅
- External integration credentials are env vars, not hardcoded? ✅

If you catch yourself writing something that fails this test, refactor before committing.

---

## Agent orchestration

See `AGENTS.md` for which Claude Code agents/skills to invoke for what. TL;DR:

- `frontend-design` → any UI work
- `code-review` → schema, auth, ingestors
- `code-simplifier` → end of session
- `poweryourleague-brand` → UI work starting Session 2 (skip for Session 1 bare-bones)
- `skill-creator` → only if we're explicitly creating a new skill

---

## Who to ask when stuck

Meesh is the only human on this project. If a decision can't be made from this file, `SCOPE.md`, or the current session brief, ask in the chat before guessing. Unblocking questions > wrong assumptions.
