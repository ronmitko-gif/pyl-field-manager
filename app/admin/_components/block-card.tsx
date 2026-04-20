import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

const SOURCE_BG: Record<string, string> = {
  sports_connect: 'bg-rec-blue text-white',
  travel_recurring: 'bg-tj-gold text-tj-black',
  override: 'bg-override-red text-white',
  manual: 'bg-manual-slate text-white',
  open_slot: 'bg-transparent text-tj-black border-2 border-dashed border-open-gray',
};

const STATUS_EXTRA: Record<string, string> = {
  confirmed: '',
  tentative: 'border-dashed border-2',
  cancelled: 'opacity-40 line-through',
  overridden: 'ring-2 ring-override-red',
  open: '',
};

function teamLabel(b: ScheduleBlock, teamName: string | null): string {
  if (b.source === 'open_slot') return 'Open slot';
  if (b.source === 'sports_connect') {
    if (b.away_team_raw && b.home_team_raw) return `${b.away_team_raw} @ ${b.home_team_raw}`;
    return b.raw_summary ?? 'Rec game';
  }
  return teamName ?? 'Block';
}

export function BlockCard({
  block, teamName, topPx, heightPx, weekParam,
}: {
  block: ScheduleBlock;
  teamName: string | null;
  topPx: number;
  heightPx: number;
  weekParam: string;
}) {
  const bg = SOURCE_BG[block.source] ?? 'bg-neutral-200 text-neutral-900';
  const status = STATUS_EXTRA[block.status] ?? '';
  const start = formatInTimeZone(new Date(block.start_at), TZ, 'h:mm a');
  const end = formatInTimeZone(new Date(block.end_at), TZ, 'h:mm a');
  const label = teamLabel(block, teamName);

  return (
    <Link
      href={`?week=${weekParam}&block=${block.id}`}
      scroll={false}
      className={`absolute left-0.5 right-0.5 rounded px-1.5 py-1 text-xs leading-tight shadow-sm hover:brightness-110 ${bg} ${status}`}
      style={{ top: topPx, height: heightPx }}
    >
      <div className="truncate font-medium">{label}</div>
      <div className="truncate opacity-80">{start} – {end}</div>
    </Link>
  );
}
