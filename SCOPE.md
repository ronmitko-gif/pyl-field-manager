# PYL Field Manager — Scope Document

**Version:** 1.0
**Owner:** Meesh (Managing Member, PowerYourLeague LLC)
**Client for test:** Thomas Jefferson Youth Baseball (TJYBB), Jefferson Hills, PA
**Document purpose:** Single source of truth for what this product is, who it's for, what it does, what it doesn't do, and how it eventually folds into PYL.

---

## 1. Problem statement

TJYBB runs two baseball programs that share one set of fields at Andrew Reilly Memorial Park:

- **Rec Minors division** — scheduled in Sports Connect, publishes an iCal feed
- **Travel Jaguars (9U A/B/C, 10U A/B)** — runs on a known weekly practice pattern, not scheduled in any system

When rec has rainouts, makeup games inevitably bump travel practices. Today, this happens through group texts, verbal coordination, and guesswork. Travel coaches find out late, show up to a field already in use, or miss that their slot was claimed at all. There is no single view of field availability across both programs, no audit trail, and no structured way for coaches to request open slots.

**The pain is acute during April–June (spring rec season) and August–October (fall ball).** Outside those windows, field demand drops and the problem is self-managing.

---

## 2. Product vision

A shared field schedule where:

- Rec games flow in automatically from Sports Connect (read-only ingest)
- Travel practices are defined once as a weekly pattern and materialize on the calendar
- Open field windows (evenings, weekends) are claimable by travel coaches with admin approval
- The admin (Meesh) can override any travel slot when a rec makeup needs it
- Affected travel coaches get an SMS immediately with the override reason and a link to find a replacement slot
- Every action is logged for accountability

The test site runs at `fields.poweryourleague.com` using real TJYBB data. Once proven with TJYBB through a full season, the same codebase lifts into PYL as a **Field Manager** module available on the Pro tier.

---

## 3. Users and roles

### 3.1 Admin
- One person during the test: Meesh
- Sees everything across all teams and all fields
- Creates and manages coach accounts
- Approves or denies slot requests
- Triggers rec-for-travel overrides
- Can manually create, edit, or cancel any block
- Views sync and notification logs

### 3.2 Travel coach
- One coach per travel team (5 travel teams at start)
- Logs in with magic link (no passwords)
- Sees their own team's scheduled practices
- Sees open slot windows and can request them
- Receives SMS when their slot is overridden or their request is approved/denied
- Cannot see other teams' requests or notifications

### 3.3 Rec coach (future, not in test scope)
- Not a user in v1 — rec schedules come from Sports Connect, rec coaches coordinate through Sports Connect
- Post-test, we may add a read-only view so rec coaches can see when they've been given a makeup slot that bumped travel

### 3.4 Parents / public (future)
- Out of scope for test
- Eventually: a public read-only calendar showing "what's happening at the field today"

---

## 4. Data sources and boundaries

### 4.1 Sports Connect (external, read-only)
- **What it owns:** Rec Minors games — times, teams, fields
- **How we read it:** Live iCal feed at a stable URL with a tenant-specific token
- **Sync cadence:** Hourly via Vercel Cron; manual "Sync now" button available to admin
- **What we store:** Each VEVENT upserted to `schedule_blocks` keyed on iCal UID
- **What we never do:** Write back to Sports Connect; try to reschedule rec games; modify rec data beyond the `status` field on our side (e.g., marking a rec game as the cause of a travel override)

### 4.2 Travel schedule (internal, we own)
- **What it is:** A set of recurring weekly slot definitions per travel team
- **How it becomes concrete:** A background job materializes the next 4 weeks of `schedule_blocks` rows from the recurring definitions
- **Why materialize rather than compute on the fly:** So overrides, notes, and status changes can attach to a specific date/time without rebuilding the schema

### 4.3 Open slots (internal, we own)
- **What they are:** Predefined windows (Friday evening, Saturday afternoons, Sunday) that travel teams can claim
- **How they work:** Materialized alongside travel slots as 2-hour blocks with `status='open'`
- **Lifecycle:** A coach submits a request → admin approves → block changes to `status='confirmed'` and gets a `team_id`. Denied requests leave the block `open` and claimable by others.

---

## 5. Core workflows

### 5.1 Rec ingest
1. Vercel Cron fires `/api/sync/sports-connect` hourly
2. Endpoint fetches iCal, parses with `node-ical`, normalizes each VEVENT
3. For each event: match `DESCRIPTION` to a field, extract team names from `SUMMARY`, upsert `schedule_blocks` row
4. Write run summary to `sync_runs`
5. If a rec game appears on a time already claimed by travel, the system does NOT auto-override — it surfaces the conflict to the admin for manual resolution

### 5.2 Travel slot materialization
1. Nightly job (or manual trigger from admin) looks at all `travel_recurring_slots` rows
2. For each, computes the next 4 weeks of concrete date/time pairs
3. Upserts `schedule_blocks` rows with `source='travel_recurring'`, team_id, field_id, status='confirmed'
4. Idempotent — re-running doesn't create duplicates

### 5.3 Open slot claim (coach-initiated)
1. Coach opens their portal, sees a list of upcoming open blocks
2. Coach clicks "Request" on a block, optionally adds a note
3. `slot_requests` row created with status='pending'
4. Admin sees the request in their approval queue
5. Admin approves → block moves to `status='confirmed'`, `team_id` set to requesting team, other pending requests for the same block auto-denied with reason
6. Admin denies → request marked denied, block stays open
7. Coach receives SMS either way

### 5.4 Rec override of travel (admin-initiated)
1. Admin views the schedule, sees a travel practice that needs to be bumped for a rec makeup
2. Admin clicks the travel block → "Override for rec makeup" → enters rec context (which teams, why)
3. System marks the travel block `status='overridden'`, creates a new rec block with `source='override'` and `overridden_by_block_id` pointing at the travel block
4. Affected travel coach gets SMS: *"Heads up — your [day] [time] practice at [field] has been bumped for a rec makeup. Here are open slots this week: [list with links]. Reply to me or tap the link to request a replacement."*
5. Notification logged; coach can request a replacement through the normal open-slot flow

### 5.5 Manual schedule entry (admin escape hatch)
1. Admin can always create a `source='manual'` block for anything ad-hoc (tournament, scrimmage, field maintenance)
2. Manual blocks behave like travel blocks — can be overridden, cancelled, or left confirmed

---

## 6. Notification strategy

### 6.1 Channels
- **SMS via Twilio** — the primary channel for time-sensitive events
- **Email via Resend or Supabase SMTP** — magic links for auth only in v1; may extend later
- **No push notifications** — not justified at the test scale, deferred to post-PYL-integration

### 6.2 What triggers an SMS
- Travel slot overridden by rec makeup → affected coach
- Slot request approved → requesting coach
- Slot request denied → requesting coach
- New open slot claimable on short notice (future, opt-in)

### 6.3 What does NOT trigger an SMS
- Routine Sports Connect syncs
- Admin manually editing their own notes on a block
- New team or coach being added (admin sends invite email instead)

### 6.4 Cost envelope
- Twilio phone number: ~$1/month
- SMS: ~$0.0083 each
- Expected volume at test scale: 30–80 SMS/month
- Total budget: **under $5/month for the test**

---

## 7. Non-goals (explicit)

- **Not a league management platform.** We don't handle registrations, payments, rosters, umpire assignments, or standings. That's Sports Connect's job for rec and GameChanger's for everything else.
- **Not a referee/umpire scheduler.** Different problem, different product.
- **Not a public-facing calendar in v1.** Admin + travel coaches only during test.
- **Not parent-facing in v1.** Parents don't log in, don't get notifications.
- **Not multi-org in v1.** TJYBB only. Multi-org comes when we fold into PYL.
- **Not a general-purpose facility booking system.** We're baseball-specific and explicitly model the rec/travel tension.
- **No scraping of Sports Connect.** iCal feed only. If the feed ever breaks, we fall back to CSV upload, not scraping.

---

## 8. Technical architecture

### 8.1 Stack
- **Frontend:** Next.js 15 (App Router, TypeScript, Tailwind), deployed on Vercel
- **Database:** Supabase Postgres with Row Level Security
- **Auth:** Supabase Auth with magic links
- **Scheduled jobs:** Vercel Cron
- **SMS:** Twilio
- **iCal parsing:** `node-ical`
- **Date/time:** Store UTC, display America/New_York via `date-fns-tz`

### 8.2 Hosting and domains
- Production: `fields.poweryourleague.com`
- Vercel project: `pyl-field-manager`
- Supabase project: `pyl-field-manager` (dedicated, NOT the existing PYL project)
- GitHub: `ronmitko-gif/pyl-field-manager`

### 8.3 Multi-tenancy stance
- Schema includes an `organizations` table from day one with a single `tjybb` row
- Every tenant-scoped table has `org_id` as a foreign key
- RLS policies reference `org_id` even though there's only one org — this means zero schema migration when we fold into PYL

### 8.4 Data retention and deletion
- Schedule blocks, requests, and notifications retained indefinitely during test
- Sync runs kept 90 days, then pruned
- User deletion cascades: deleting a coach soft-deletes their requests and notifications, does not delete schedule blocks (those are organizational data)

---

## 9. Roadmap — sessions to ship

**Session 1 — Foundation** *(in progress / up next)*
- Project scaffold, Supabase schema and seed, auth, iCal ingestor, bare admin view
- Exit criteria: deployed at `fields.poweryourleague.com`; admin logs in; hourly sync pulls real rec games

**Session 2 — Weekly grid + travel materialization**
- Calendar UI (week and day views) showing all blocks color-coded by source
- Travel recurring slot materialization job
- Admin block detail panel (read + simple edits)
- Exit criteria: admin can see and edit any block; travel slots appear alongside rec games

**Session 3 — CSV fallback + field matching polish**
- CSV upload for Sports Connect as backup if iCal breaks
- Admin UI for managing fields and coaches
- Better error handling when `DESCRIPTION` doesn't match a known field
- Exit criteria: admin can onboard a new field or coach without a database migration

**Session 4 — Coach portal and slot requests**
- Coach login → team view
- Request flow for open slots
- Admin approval queue
- Exit criteria: a travel coach can claim a Friday night slot end-to-end

**Session 5 — Override flow + SMS**
- Twilio integration with dev/test/production modes
- Override UI on travel blocks
- SMS on override and on request decisions
- Notifications log view for admin
- Exit criteria: Meesh can override a travel practice and the coach gets a text within 10 seconds

**Session 6 — Polish, PYL brand skin, first real user**
- Apply the PowerYourLeague brand skill
- Add public read-only block view (optional)
- Seed remaining travel coaches
- Invite first 1–2 travel coaches to actually use it
- Exit criteria: a real travel coach logs in and finds nothing broken for 1 week

**Post-test — PYL integration (after a full spring season)**
- Add `account_id` multi-tenancy layer in PYL's codebase
- Port the Field Manager module
- Expose as a Pro-tier feature
- Document for new organizations onboarding

---

## 10. Success criteria

### 10.1 Test success (TJYBB spring 2026)
- Every rec makeup that bumps a travel practice is communicated via the app, not a group text
- Zero cases of a travel team showing up to a field that was already claimed
- Meesh spends less than 5 minutes per week administering the schedule after initial setup
- At least 3 of 5 travel coaches actually use the coach portal (vs. ignoring it)

### 10.2 PYL integration success
- The Field Manager module ships as a Pro-tier feature with no rewrites to the core logic
- Onboarding a new organization takes under 30 minutes (create org, add fields, add teams, configure recurring slots, invite coaches)
- First external org can onboard without Meesh being in the loop on every step

---

## 11. Known risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sports Connect changes iCal format | Low | High | Log raw SUMMARY/DESCRIPTION, alert on parse failures, CSV fallback in Session 3 |
| iCal token rotation | Low | Medium | Token stored in env var only; rotating is a 2-minute env var update |
| Travel coaches don't adopt the portal | Medium | High | SMS-first notifications mean they don't have to log in to get value |
| Twilio costs balloon | Low | Low | Hard cap in Twilio console; log every message to `notifications` for audit |
| Sports Connect iCal shows only rec (confirmed Apr 2026) — if travel ever ends up in the feed, double-counting risk | Medium | Medium | Dedup on iCal UID; ingestor tags source_feed_id; manual review on first mixed run |
| Meesh is sole operator | High | Medium | Document every env var, every manual step, every schema change — this document is the start |

---

## 12. Glossary

- **Block** — a concrete scheduled time on a specific field (game, practice, override, or open slot)
- **Rec** — Thomas Jefferson Youth Baseball's recreational Minors division, scheduled in Sports Connect
- **Travel** — the TJ Jaguars competitive teams (9U/10U), scheduled in this app
- **Override** — an admin action that bumps a travel block for a rec makeup
- **Open slot** — a block on a field that's available to be claimed by a travel coach, pending approval
- **Materialization** — the process of turning recurring rules into concrete dated blocks
- **Sports Connect** — the league management platform TJYBB uses for rec (formerly Blue Sombrero, owned by Stack Sports)
- **PYL** — PowerYourLeague, Meesh's multi-tenant youth sports platform this will eventually fold into

---

## 13. Open questions (to resolve during the build)

- What's the exact field name for the second Reilly field in Sports Connect — "885 Front Field (Huber)" or "885 Front Field"? (Determined during first sync)
- Does Sports Connect publish per-team feeds or only one league-wide feed? (Relevant if travel ever gets added to Sports Connect)
- What happens if a travel coach requests an open slot while a pending request already exists for the same block? (First-come queue vs. admin picks — currently: first-come, admin can pick any pending one)
- Do we want to support split blocks (e.g., first hour one team, second hour another)? (Deferred — if it comes up, we make two 1-hour blocks manually)
