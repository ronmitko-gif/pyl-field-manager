import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

async function triggerSync() {
  'use server';
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET not set');
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  await fetch(`${base}/api/sync/sports-connect`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    cache: 'no-store',
  });
  revalidatePath('/admin');
}

export default async function AdminPage() {
  const supabase = await createClient();

  const twoWeeksOut = new Date();
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  const [runsRes, blocksRes, fieldsRes] = await Promise.all([
    supabase
      .from('sync_runs')
      .select('*')
      .eq('source', 'sports_connect')
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('schedule_blocks')
      .select('*')
      .gte('start_at', new Date().toISOString())
      .lte('start_at', twoWeeksOut.toISOString())
      .order('start_at', { ascending: true })
      .limit(200),
    supabase.from('fields').select('id, short_name, name'),
  ]);

  const fieldName = new Map(
    (fieldsRes.data ?? []).map((f) => [f.id, f.short_name ?? f.name])
  );

  return (
    <div className="space-y-8">
      <section className="rounded border bg-white p-4">
        <form action={triggerSync}>
          <button className="rounded bg-black px-4 py-2 text-sm text-white">
            Sync now
          </button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Manually triggers the same endpoint Vercel Cron hits every hour at :15.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Recent sync runs
        </h2>
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="p-2">Started</th>
                <th className="p-2">Status</th>
                <th className="p-2">Seen</th>
                <th className="p-2">Inserted</th>
                <th className="p-2">Updated</th>
                <th className="p-2">Errors</th>
              </tr>
            </thead>
            <tbody>
              {(runsRes.data ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">
                    {formatInTimeZone(new Date(r.started_at), TZ, 'yyyy-MM-dd HH:mm')}
                  </td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.events_seen}</td>
                  <td className="p-2">{r.events_inserted}</td>
                  <td className="p-2">{r.events_updated}</td>
                  <td className="p-2">
                    {r.errors ? JSON.stringify(r.errors).slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
              {(runsRes.data ?? []).length === 0 && (
                <tr>
                  <td className="p-3 text-neutral-500" colSpan={6}>
                    No runs yet. Click &quot;Sync now&quot; above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Next 14 days — schedule blocks
        </h2>
        <div className="overflow-hidden rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Time (ET)</th>
                <th className="p-2">Field</th>
                <th className="p-2">Source</th>
                <th className="p-2">Teams / Notes</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(blocksRes.data ?? []).map((b) => {
                const start = new Date(b.start_at);
                const end = new Date(b.end_at);
                const teams =
                  b.away_team_raw && b.home_team_raw
                    ? `${b.away_team_raw} @ ${b.home_team_raw}`
                    : b.notes ?? '—';
                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-2">{formatInTimeZone(start, TZ, 'EEE MMM d')}</td>
                    <td className="p-2">
                      {formatInTimeZone(start, TZ, 'h:mm a')} –{' '}
                      {formatInTimeZone(end, TZ, 'h:mm a')}
                    </td>
                    <td className="p-2">{fieldName.get(b.field_id) ?? b.field_id}</td>
                    <td className="p-2">{b.source}</td>
                    <td className="p-2">{teams}</td>
                    <td className="p-2">{b.status}</td>
                  </tr>
                );
              })}
              {(blocksRes.data ?? []).length === 0 && (
                <tr>
                  <td className="p-3 text-neutral-500" colSpan={6}>
                    No blocks in the next 14 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
