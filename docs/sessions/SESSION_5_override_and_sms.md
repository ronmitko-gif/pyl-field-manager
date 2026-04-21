# Session 5 — Override Flow + Twilio SMS

**Status:** Complete (landed 2026-04-21)
**Goal:** Give admin a one-click override for travel blocks when rec needs the field, wire Twilio SMS alongside the Session 4 emails, and surface every notification attempt in a log page. Add auto-override so Sports Connect sync handles the routine case by itself.

---

## Scope delivered

### Twilio SMS library
- **`lib/sms/send.ts`** — native-fetch wrapper over Twilio's REST API. No npm dep.
- **Three modes via `TWILIO_MODE`:**
  - `dev` — logs to console, no network call. Default in local `.env.local`.
  - `test` — uses Twilio test credentials + magic "valid" from-number `+15005550006`. No real SMS.
  - `prod` — real send. Default when unset.
- **Graceful degradation:** if Twilio creds are missing in prod, `sendSms` returns `{ ok: false, error: 'TWILIO_ACCOUNT_SID not set' }`. Notifications table records the failure; override / approval actions still complete.
- 4 unit tests cover mode switching, success path, failure path, missing-creds path.

### Notifications enqueue (email + SMS)
- `lib/notifications/enqueue.ts` now parallel-sends email AND SMS for coach-facing events.
- New `persistAndSendSms` helper: inserts a `notifications` row, calls Twilio (or skips if no phone), updates status.
- **No phone = status='skipped'** (no error noise, still a row for audit).
- **New function** `notifyTravelOverridden` — email + SMS to every coach on the bumped team.
- SMS templates under 160 chars: approve / deny / supersede / override.
- Admin's email for "new slot request submitted" stays email-only (admins don't need SMS on every request).

### Manual override UI + action
- **`OverrideForm` client component** (`app/admin/_components/override-form.tsx`) — inline expandable form inside the block drawer. Fields: away team, home team, optional reason. Native `confirm()` prompt before submit.
- **`BlockDrawer` updated:** shows "Override for rec makeup" button on future confirmed travel/manual blocks. On blocks with `status='overridden'`, shows a red banner with the reason and a link to the replacement block.
- **`overrideTravelBlock` server action** in `app/admin/_actions.ts`:
  1. Creates a replacement block: `source='override'`, `status='confirmed'`, home/away teams + reason
  2. Marks the original: `status='overridden'`, `overridden_by_block_id`, `override_reason`
  3. Loads all coaches on the overridden block's team
  4. Calls `notifyTravelOverridden` (email + SMS per coach)

### Auto-override on sync (bonus)
- `lib/ical/ingest.ts` runs a conflict scan at the end of every Sports Connect sync.
- For each future confirmed rec block on a field: find any confirmed travel/manual block on the same field whose time overlaps → mark it overridden (`override_reason='Auto-override: rec game <away> @ <home>'`), link via `overridden_by_block_id`, notify the travel team's coaches.
- Counts surfaced in the sync response as `auto_overrides`. Sync runs table already shows the run — the notifications log shows each outbound message.
- Runs **after** stale cleanup so we never override based on stale data.

### `/admin/notifications` log page
- Lists last 100 notifications (auto-revalidates every 60s).
- Filter chips: All · Email · SMS · Failed (via `?filter=` URL param).
- Columns: relative time, channel icon (📧/📱), coach, body preview (stripped HTML, first 80 chars), status pill, error (if any).
- Added "Notifications" to admin secondary nav.

### Schema migration 0004
- Added `'skipped'` to `notifications.status` check constraint so the no-phone case isn't an error.

---

## Bugs caught during implementation

1. **`server-only` import broke vitest** — `lib/sms/send.ts` imports `server-only` (a Next.js-provided module) which vitest's Node runtime can't resolve. Fixed by aliasing `'server-only'` to an empty stub at `lib/test-stubs/server-only.ts` in `vitest.config.ts`.
2. **Resend API key accidentally committed to `.env.example`** — an IDE autosave or linter copied the local `.env.local` value into `.env.example` between my Edit and commit. I pushed the commit before noticing. Rotated the key, redacted the file, and updated Supabase SMTP + Vercel env with the new key. GitHub commit history still contains the old (now-revoked) key.
3. **Coach type drift** — added optional `phone` to the notification `Coach` interface; needed to update every call site in `app/admin/_actions.ts` and `app/coach/_actions.ts` to pass phone through.

---

## New/modified files

```
supabase/migrations/
  0004_notifications_skipped.sql                (new)

lib/
  sms/
    send.ts                                     (new)
    send.test.ts                                (new, 4 tests)
  notifications/
    enqueue.ts                                  (rewrite — SMS parallel to email + notifyTravelOverridden)
  ical/
    ingest.ts                                   (modify — auto-override at end of sync)
  test-stubs/
    server-only.ts                              (new, 2-line stub for vitest)

vitest.config.ts                                (modify — alias 'server-only')

app/admin/
  _actions.ts                                   (modify — overrideTravelBlock + phone passed through)
  _components/
    admin-nav.tsx                               (modify — add Notifications link)
    block-drawer.tsx                            (modify — override form + overridden-state banner)
    override-form.tsx                           (new, client)
  notifications/
    page.tsx                                    (new, RSC)

app/coach/
  _actions.ts                                   (modify — phone added to coach select)

.env.example                                    (add TWILIO_* + RESEND redaction fix)
.env.local                                      (add TWILIO_* placeholders with TWILIO_MODE=dev)
```

---

## Env vars

- **New:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MODE`
  - Local dev: `TWILIO_MODE=dev`, other three blank (no real SMS).
  - Vercel prod: **NOT SET** this session — prod SMS attempts will log a graceful `"TWILIO_ACCOUNT_SID not set"` error. Set them when ready to pay Twilio.
- **Rotated:** `RESEND_API_KEY` — old key revoked, new key in `.env.local`, Supabase SMTP, and Vercel prod.

---

## What's live

- **Prod:** https://fields.poweryourleague.com
- **Relevant commits:**
  - `5fe98cc` — Twilio lib
  - `6a11d96` — SMS in notifications
  - `3e7747d` — override UI + action + notifications log
  - `4b5d865` — Resend key redaction
  - `4669494` — auto-override on sync

---

## Verification checklist

- [x] Migration 0004 applied
- [x] `lib/sms/send.ts` passes tests in all 3 modes
- [x] Override button appears on future confirmed travel blocks
- [x] Override creates replacement block + marks original overridden
- [x] Manual override works end-to-end (test ran by Meesh — no notification because test team had no coach row; expected behavior)
- [x] `/admin/notifications` page renders with filter chips
- [x] Nav shows Notifications link
- [ ] Prod SMS verified end-to-end — deferred; Twilio not wired yet
- [x] Auto-override logic runs on sync (visible in `auto_overrides` count in sync JSON response)

---

## What's NOT in Session 5

- Un-override button (admin can delete the override block + reset travel block manually via SQL)
- Re-overriding an already-overridden block
- SMS replies / two-way SMS
- Retry for failed notifications
- SMS to admins (admins get email only on request-submitted; same going forward)

---

## Manual steps for Meesh

1. **(Optional) Wire Twilio:** create a Twilio trial account, purchase or use a trial number, add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` to `.env.local` and Vercel prod, set `TWILIO_MODE=prod` in Vercel. Until then, email notifications work; SMS attempts are logged as failures in `/admin/notifications`.
2. **Add real coach rows** for the 5 travel teams (`/admin/coaches/new`) with phone numbers so override notifications actually reach someone.
3. **Clean up the leaked Resend key in GitHub history:** consider running a `git filter-branch` or BFG to scrub commit `055e6c5`. Low-priority since the key is revoked, but removes it from the paper trail for anyone who forks the repo.

---

## Session 6 preview

Polish + PYL-brand skin + first real user:
- Apply `poweryourleague-brand` skill now that the product's settled on TJ palette (multi-tenant theming can come post-PYL-port)
- Optional public read-only field view
- Any last-mile UX (error messages, empty states, mobile tweaks)
- Invite 1–2 travel coaches to actually use it for a week

No Session 5 loose ends blocking Session 6.
