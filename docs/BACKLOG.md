# Backlog

Ideas that came up mid-session but aren't in a session brief. Each line: one-sentence rationale. Graduate to a session brief when prioritized.

---

- **Wire custom SMTP for Supabase magic links** — free-tier Supabase caps built-in email at ~2/hour per project, which we hit repeatedly during Session 1 testing. Fix before first real coach onboards: Resend free tier (100/day) → Supabase Dashboard → Authentication → Emails → SMTP Settings. Removes the rate limit and gives us branded sender addresses.
- **Re-enable hourly Sports Connect sync** — Vercel Hobby only allows daily crons, so `vercel.json` cron was removed in Session 1 to ship. Options: (1) upgrade to Vercel Pro ($20/mo), (2) wire an external scheduler (cron-job.org, EasyCron, GitHub Actions) that POSTs to `/api/sync/sports-connect` with the `CRON_SECRET` bearer token. Admin "Sync now" button still works as a manual fallback.
- **Rename `middleware.ts` → `proxy.ts`** — Next 16 deprecated the `middleware` file convention in favor of `proxy`. Works today, warning at build/start. Low priority; ship when touching auth next.
- **Full prod login smoke test** — local login verified end-to-end in Session 1; prod login test deferred due to Supabase email rate limit. Retry once SMTP is wired (or after rate limit resets) to confirm `https://fields.poweryourleague.com/login` → magic link → `/admin` flow.
