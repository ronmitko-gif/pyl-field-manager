'use client';

import Link from 'next/link';
import {
  currentWeek,
  nextWeek as nextOf,
  prevWeek as prevOf,
  weekLabel,
  type WeekBounds,
} from '@/lib/calendar/week';

export function WeekNav({ week }: { week: WeekBounds }) {
  const prev = prevOf(week);
  const next = nextOf(week);
  const today = currentWeek();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tj-black/10 bg-white px-3 py-2 text-sm">
      <Link href={`?week=${prev.param}`} scroll={false} className="rounded px-2 py-1 hover:bg-tj-cream" aria-label="Previous week">◀</Link>
      <div className="min-w-[180px] text-center font-medium">Week of {weekLabel(week)}</div>
      <Link href={`?week=${next.param}`} scroll={false} className="rounded px-2 py-1 hover:bg-tj-cream" aria-label="Next week">▶</Link>
      {week.param !== today.param && (
        <Link href={`?week=${today.param}`} scroll={false} className="ml-2 rounded bg-tj-gold px-3 py-1 text-tj-black hover:bg-tj-gold-soft">Today</Link>
      )}
    </div>
  );
}
