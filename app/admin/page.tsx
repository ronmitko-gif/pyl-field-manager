import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatInTimeZone } from 'date-fns-tz';
import { parseWeekParam, defaultDayIndex } from '@/lib/calendar/week';
import { expandWindows } from '@/lib/requests/availability';
import type { OpenWindow } from '@/lib/requests/windows';
import { SyncButtons } from './_components/sync-buttons';
import { WeekNav } from './_components/week-nav';
import { WeekGrid } from './_components/week-grid';
import { DayList } from './_components/day-list';
import { UpcomingList } from './_components/upcoming-list';
import { OpenWindowsList } from '@/app/coach/_components/open-windows-list';
import { BlockDrawer } from './_components/block-drawer';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; block?: string; day?: string }>;
}) {
  const params = await searchParams;
  const week = parseWeekParam(params.week);
  const dayIndex = params.day ? Math.min(6, Math.max(0, Number(params.day))) : defaultDayIndex(week);

  const supabase = await createClient();
  const admin = createAdminClient();

  // We need org_id for the open_windows query — every admin's coaches row has one.
  // Fetch a single org row (tjybb is the only one).
  const { data: org } = await admin.from('organizations').select('id').eq('slug', 'tjybb').single();
  const orgId = org?.id ?? '';

  const fourWeeksOut = new Date();
  fourWeeksOut.setUTCDate(fourWeeksOut.getUTCDate() + 28);

  const [blocksWeekRes, fieldsRes, teamsRes, upcomingRes, windowsRes, allBlocksRes, runsRes] = await Promise.all([
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', week.start.toISOString())
      .lt('start_at', week.endExclusive.toISOString())
      .order('start_at').limit(500),
    supabase.from('fields').select('id, name, short_name'),
    supabase.from('teams').select('id, name'),
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', new Date().toISOString())
      .order('start_at').limit(10),
    admin.from('open_windows').select('id, field_id, day_of_week, start_time, end_time').eq('org_id', orgId),
    admin.from('schedule_blocks').select('id, field_id, team_id, start_at, end_at, status, source')
      .gte('start_at', new Date().toISOString())
      .lte('start_at', fourWeeksOut.toISOString())
      .in('status', ['confirmed', 'tentative'])
      .order('start_at').limit(500),
    supabase.from('sync_runs').select('*')
      .order('started_at', { ascending: false }).limit(5),
  ]);

  const blocks = (blocksWeekRes.data ?? []) as ScheduleBlock[];
  const upcoming = (upcomingRes.data ?? []) as ScheduleBlock[];
  const fields = fieldsRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const runs = runsRes.data ?? [];
  const windows = (windowsRes.data ?? []) as OpenWindow[];
  const allBlocks = (allBlocksRes.data ?? []) as ScheduleBlock[];
  const windowInstances = expandWindows(windows, allBlocks, 28);
  const fieldNameById = new Map(fields.map((f) => [f.id, f.short_name ?? f.name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SyncButtons />
        <WeekNav week={week} />
      </div>

      <WeekGrid week={week} fields={fields} blocks={blocks} teams={teams} />
      <DayList week={week} fields={fields} blocks={blocks} teams={teams} day={dayIndex} />

      <div className="grid gap-4 md:grid-cols-2">
        <UpcomingList blocks={upcoming} fields={fields} teams={teams} weekParam={week.param} />
        <section className="rounded-lg border border-tj-black/10 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">Open windows coming up</h3>
          <OpenWindowsList instances={windowInstances} fieldNameById={fieldNameById} limit={10} />
        </section>
      </div>

      <section className="rounded-lg border border-tj-black/10 bg-white">
        <h2 className="border-b border-tj-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">Recent sync runs</h2>
        <table className="w-full text-sm">
          <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
            <tr>
              <th className="p-2">Started</th>
              <th className="p-2">Source</th>
              <th className="p-2">Status</th>
              <th className="p-2">Seen</th>
              <th className="p-2">Ins</th>
              <th className="p-2">Upd</th>
              <th className="p-2">Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const errorItems = Array.isArray(r.errors) ? r.errors : [];
              const unmapped: string[] = errorItems
                .map((e: { message?: string }): string | null => {
                  const m = /DESCRIPTION="([^"]+)"/.exec(e?.message ?? '');
                  return m ? m[1] : null;
                })
                .filter((s: string | null): s is string => Boolean(s));
              const otherErrors = errorItems.filter((e: { message?: string }) =>
                !/DESCRIPTION="/.test(e?.message ?? '')
              );
              return (
                <tr key={r.id} className="border-t border-tj-black/5 align-top">
                  <td className="p-2 whitespace-nowrap">{formatInTimeZone(new Date(r.started_at), TZ, 'MM-dd HH:mm')}</td>
                  <td className="p-2">{r.source}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.events_seen}</td>
                  <td className="p-2">{r.events_inserted}</td>
                  <td className="p-2">{r.events_updated}</td>
                  <td className="p-2">
                    {unmapped.length === 0 && otherErrors.length === 0 && '—'}
                    {unmapped.map((desc: string) => (
                      <div key={desc} className="mb-1 flex items-center gap-2">
                        <code className="rounded bg-tj-cream px-1 py-0.5 text-xs">{desc}</code>
                        <Link
                          href={`/admin/fields?unmapped=${encodeURIComponent(desc)}`}
                          className="rounded bg-tj-gold px-2 py-0.5 text-xs font-medium text-tj-black hover:bg-tj-gold-soft"
                        >
                          Fix →
                        </Link>
                      </div>
                    ))}
                    {otherErrors.length > 0 && (
                      <div className="text-xs opacity-70">
                        {JSON.stringify(otherErrors).slice(0, 60)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr><td colSpan={7} className="p-3 text-tj-black/50">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {params.block && <BlockDrawer blockId={params.block} weekParam={week.param} />}
    </div>
  );
}
