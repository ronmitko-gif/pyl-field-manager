import 'server-only';
import { addDays, format, parseISO } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { OpenWindow } from './windows';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

export type WindowInstance = {
  field_id: string;
  date: string; // "YYYY-MM-DD" in ET
  window: OpenWindow;
  /** Confirmed / tentative blocks overlapping the window on this date, sorted by start. */
  taken: Array<{ id: string; start_at: string; end_at: string; team_id: string | null; source: string }>;
};

/**
 * Expand the given open windows across the next `days` calendar days (starting today),
 * one instance per (date, window), annotated with any overlapping confirmed/tentative blocks.
 */
export function expandWindows(
  windows: OpenWindow[],
  blocks: ScheduleBlock[],
  days: number = 28
): WindowInstance[] {
  const instances: WindowInstance[] = [];
  const todayEt = toZonedTime(new Date(), TZ);
  todayEt.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i++) {
    const d = addDays(todayEt, i);
    const dow = d.getDay();
    const isoDate = format(d, 'yyyy-MM-dd');
    for (const window of windows) {
      if (window.day_of_week !== dow) continue;
      const startUtc = fromZonedTime(`${isoDate}T${window.start_time}`, TZ);
      const endUtc = fromZonedTime(`${isoDate}T${window.end_time}`, TZ);
      const taken = blocks
        .filter((b) => {
          if (b.field_id !== window.field_id) return false;
          if (b.status !== 'confirmed' && b.status !== 'tentative') return false;
          const bs = new Date(b.start_at).getTime();
          const be = new Date(b.end_at).getTime();
          return bs < endUtc.getTime() && be > startUtc.getTime();
        })
        .map((b) => ({
          id: b.id,
          start_at: b.start_at,
          end_at: b.end_at,
          team_id: b.team_id,
          source: b.source,
        }))
        .sort((a, b) => a.start_at.localeCompare(b.start_at));
      instances.push({ field_id: window.field_id, date: isoDate, window, taken });
    }
  }

  return instances;
}
