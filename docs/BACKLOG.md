# Backlog

Ideas that came up mid-session but aren't in a session brief. Each line: one-sentence rationale. Graduate to a session brief when prioritized.

---

- **Re-enable hourly Sports Connect sync** — Vercel Hobby only allows daily crons, so `vercel.json` cron was removed in Session 1 to ship. Options: (1) upgrade to Vercel Pro ($20/mo), (2) wire an external scheduler (cron-job.org, EasyCron, GitHub Actions) that POSTs to `/api/sync/sports-connect` with the `CRON_SECRET` bearer token. Admin "Sync now" button still works as a manual fallback.
- **Rename `middleware.ts` → `proxy.ts`** — Next 16 deprecated the `middleware` file convention in favor of `proxy`. Works today, warning at build/start. Low priority; ship when touching auth next.
