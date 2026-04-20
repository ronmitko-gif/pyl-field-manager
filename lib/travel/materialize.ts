import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDays, format, parseISO } from 'date-fns';
import type { TravelRecurringSlot, MaterializedBlock } from '@/lib/types';

const TZ = 'America/New_York';

export function materializeSlot(
  slot: TravelRecurringSlot,
  orgId: string,
  windowStart: Date,
  windowEndExclusive: Date
): MaterializedBlock[] {
  const effectiveFrom = parseISO(slot.effective_from);
  const effectiveTo = slot.effective_to ? parseISO(slot.effective_to) : null;

  const blocks: MaterializedBlock[] = [];

  let cursorEt = toZonedTime(windowStart, TZ);
  cursorEt = new Date(cursorEt.getFullYear(), cursorEt.getMonth(), cursorEt.getDate());

  const endEt = toZonedTime(windowEndExclusive, TZ);

  while (cursorEt < endEt) {
    const dow = cursorEt.getDay();
    const isoDate = format(cursorEt, 'yyyy-MM-dd');
    const dateOnly = parseISO(isoDate);

    const beforeEffective = dateOnly < effectiveFrom;
    const afterEffective = effectiveTo !== null && dateOnly > effectiveTo;

    if (dow === slot.day_of_week && !beforeEffective && !afterEffective) {
      const start_at = fromZonedTime(`${isoDate}T${slot.start_time}`, TZ);
      const end_at = fromZonedTime(`${isoDate}T${slot.end_time}`, TZ);
      blocks.push({
        org_id: orgId,
        team_id: slot.team_id,
        field_id: slot.field_id,
        start_at,
        end_at,
        source_uid: `travel:${slot.id}:${isoDate}`,
      });
    }

    cursorEt = addDays(cursorEt, 1);
  }

  return blocks;
}
