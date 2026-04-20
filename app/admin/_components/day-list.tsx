import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';
import type { WeekBounds } from '@/lib/calendar/week';

const TZ = 'America/New_York';

type Field = { id: string; name: string; short_name: string | null };
type Team = { id: string; name: string };

function label(b: ScheduleBlock, teamName: string | null): string {
  if (b.source === 'open_slot') return 'Open slot';
  if (b.source === 'sports_connect' && b.away_team_raw && b.home_team_raw) {
    return `${b.away_team_raw} @ ${b.home_team_raw}`;
  }
  return teamName ?? b.raw_summary ?? 'Block';
}

export function DayList({
  week, fields, blocks, teams, day,
}: {
  week: WeekBounds;
  fields: Field[];
  blocks: ScheduleBlock[];
  teams: Team[];
  day: number;
}) {
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const fieldNameById = new Map(fields.map((f) => [f.id, f.short_name ?? f.name]));

  const dayStart = new Date(week.start);
  dayStart.setUTCDate(dayStart.getUTCDate() + day);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const dayBlocks = blocks
    .filter((b) => {
      const bs = new Date(b.start_at);
      return bs >= dayStart && bs < dayEnd;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div className="flex flex-col gap-4 md:hidden">
      <div className="flex gap-1 overflow-x-auto">
        {Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(week.start);
          d.setUTCDate(d.getUTCDate() + i);
          const isActive = i === day;
          return (
            <Link key={i} href={`?week=${week.param}&day=${i}`} scroll={false} className={`shrink-0 rounded-full px-3 py-1 text-xs ${isActive ? 'bg-tj-black text-tj-cream' : 'bg-white text-tj-black border border-tj-black/10'}`}>
              {formatInTimeZone(d, TZ, 'EEE d')}
            </Link>
          );
        })}
      </div>
      {dayBlocks.length === 0 && (
        <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">No blocks this day.</p>
      )}
      <ul className="flex flex-col gap-2">
        {dayBlocks.map((b) => (
          <li key={b.id}>
            <Link href={`?week=${week.param}&day=${day}&block=${b.id}`} scroll={false} className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
              <div>
                <div className="font-medium">{label(b, b.team_id ? teamNameById.get(b.team_id) ?? null : null)}</div>
                <div className="text-xs opacity-70">
                  {fieldNameById.get(b.field_id) ?? b.field_id} · {formatInTimeZone(new Date(b.start_at), TZ, 'h:mm a')} – {formatInTimeZone(new Date(b.end_at), TZ, 'h:mm a')}
                </div>
              </div>
              <span className="text-xs uppercase tracking-wide opacity-60">{b.source.replace('_', ' ')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
