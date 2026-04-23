import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseWeekParam, defaultDayIndex } from '@/lib/calendar/week';
import type { ScheduleBlock } from '@/lib/types';
import { WeekNav } from '@/app/admin/_components/week-nav';
import { WeekGrid } from '@/app/admin/_components/week-grid';
import { DayList } from '@/app/admin/_components/day-list';

export default async function PublicSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; day?: string }>;
}) {
  const params = await searchParams;
  const week = parseWeekParam(params.week);
  const dayIndex = params.day ? Math.min(6, Math.max(0, Number(params.day))) : defaultDayIndex(week);

  const admin = createAdminClient();

  const [blocksRes, fieldsRes, teamsRes, syncRes] = await Promise.all([
    admin
      .from('schedule_blocks')
      .select('*')
      .gte('start_at', week.start.toISOString())
      .lt('start_at', week.endExclusive.toISOString())
      .neq('status', 'cancelled')
      .order('start_at')
      .limit(500),
    admin.from('fields').select('id, name, short_name'),
    admin.from('teams').select('id, name'),
    admin
      .from('sync_runs')
      .select('ended_at')
      .eq('source', 'sports_connect')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const blocks = (blocksRes.data ?? []) as ScheduleBlock[];
  const fields = fieldsRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const lastSync = syncRes.data?.ended_at as string | null | undefined;

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <div>
          <div className="text-xs uppercase tracking-wide text-tj-gold">TJYBB</div>
          <h1 className="text-lg font-semibold">Field Schedule — Andrew Reilly Memorial Park</h1>
        </div>
        <Link href="/login" className="text-sm text-tj-gold-soft hover:text-tj-gold underline underline-offset-4">
          Coach / admin sign in →
        </Link>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-3">
          <WeekNav week={week} />
          {lastSync && (
            <div className="text-xs opacity-60">
              Synced {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}
            </div>
          )}
        </div>

        <WeekGrid week={week} fields={fields} blocks={blocks} teams={teams} readonly />
        <DayList week={week} fields={fields} blocks={blocks} teams={teams} day={dayIndex} readonly />

        <p className="text-xs opacity-50">
          Public read-only view. Questions? Ask Meesh.
        </p>
      </main>
    </div>
  );
}
