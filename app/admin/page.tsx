import { createClient } from '@/lib/supabase/server';
import { formatInTimeZone } from 'date-fns-tz';
import { parseWeekParam } from '@/lib/calendar/week';
import { SyncButtons } from './_components/sync-buttons';
import { WeekNav } from './_components/week-nav';
import { WeekGrid } from './_components/week-grid';
import { DayList } from './_components/day-list';
import { UpcomingList } from './_components/upcoming-list';
import { OpenSlotsList } from './_components/open-slots-list';
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
  const dayIndex = params.day ? Math.min(6, Math.max(0, Number(params.day))) : 0;

  const supabase = await createClient();

  const [blocksWeekRes, fieldsRes, teamsRes, upcomingRes, openSlotsRes, runsRes] = await Promise.all([
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', week.start.toISOString())
      .lt('start_at', week.endExclusive.toISOString())
      .order('start_at').limit(500),
    supabase.from('fields').select('id, name, short_name'),
    supabase.from('teams').select('id, name'),
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', new Date().toISOString())
      .neq('source', 'open_slot')
      .order('start_at').limit(10),
    supabase.from('schedule_blocks').select('*')
      .gte('start_at', new Date().toISOString())
      .eq('source', 'open_slot').eq('status', 'open')
      .order('start_at').limit(10),
    supabase.from('sync_runs').select('*')
      .order('started_at', { ascending: false }).limit(5),
  ]);

  const blocks = (blocksWeekRes.data ?? []) as ScheduleBlock[];
  const upcoming = (upcomingRes.data ?? []) as ScheduleBlock[];
  const openSlots = (openSlotsRes.data ?? []) as ScheduleBlock[];
  const fields = fieldsRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const runs = runsRes.data ?? [];

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
        <OpenSlotsList blocks={openSlots} fields={fields} weekParam={week.param} />
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
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-tj-black/5">
                <td className="p-2">{formatInTimeZone(new Date(r.started_at), TZ, 'MM-dd HH:mm')}</td>
                <td className="p-2">{r.source}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{r.events_seen}</td>
                <td className="p-2">{r.events_inserted}</td>
                <td className="p-2">{r.events_updated}</td>
                <td className="p-2">{r.errors ? JSON.stringify(r.errors).slice(0, 60) : '—'}</td>
              </tr>
            ))}
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
