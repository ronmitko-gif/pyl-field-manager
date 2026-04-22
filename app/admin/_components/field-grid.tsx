import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';
import { BlockCard } from './block-card';

const TZ = 'America/New_York';
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const ROW_HEIGHT_PX = 32;
const HOURS_PER_DAY = DAY_END_HOUR - DAY_START_HOUR;

function dayColumn(weekStart: Date, dayIndex: number) {
  const start = new Date(weekStart);
  start.setUTCDate(start.getUTCDate() + dayIndex);
  return start;
}

function hoursOffsetInDay(blockStart: Date, dayStartUtc: Date): number {
  return (blockStart.getTime() - dayStartUtc.getTime()) / (1000 * 60 * 60);
}

export function FieldGrid({
  fieldId, fieldName, weekStart, weekParam, blocks, teamNameById, readonly = false,
}: {
  fieldId: string;
  fieldName: string;
  weekStart: Date;
  weekParam: string;
  blocks: ScheduleBlock[];
  teamNameById: Map<string, string>;
  readonly?: boolean;
}) {
  const fieldBlocks = blocks.filter((b) => b.field_id === fieldId);
  const days = Array.from({ length: 7 }, (_, i) => dayColumn(weekStart, i));

  return (
    <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white shadow-sm">
      <h3 className="border-b border-tj-black/10 bg-tj-black px-4 py-2 text-sm font-semibold text-tj-cream">
        {fieldName}
      </h3>
      <div className="grid" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
        <div className="border-b border-r border-tj-black/10 bg-tj-cream" />
        {days.map((d) => (
          <div key={d.toISOString()} className="border-b border-r border-tj-black/10 bg-tj-cream px-2 py-1 text-center text-xs font-medium">
            <div>{formatInTimeZone(d, TZ, 'EEE')}</div>
            <div className="text-[10px] opacity-70">{formatInTimeZone(d, TZ, 'MMM d')}</div>
          </div>
        ))}

        <div>
          {Array.from({ length: HOURS_PER_DAY }).map((_, i) => (
            <div key={i} className="flex items-start justify-end border-r border-b border-tj-black/10 pr-1 pt-0.5 text-[10px] text-tj-black/50" style={{ height: ROW_HEIGHT_PX }}>
              {formatInTimeZone(new Date(Date.UTC(2026, 0, 1, DAY_START_HOUR + i, 0)), 'UTC', 'h a').toLowerCase()}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayStartUtc = new Date(day);
          const dayEndUtc = new Date(day);
          dayEndUtc.setUTCDate(dayEndUtc.getUTCDate() + 1);
          const dayBlocks = fieldBlocks.filter((b) => {
            const bs = new Date(b.start_at);
            return bs >= dayStartUtc && bs < dayEndUtc;
          });
          return (
            <div key={day.toISOString()} className="relative border-r border-b border-tj-black/10" style={{ height: HOURS_PER_DAY * ROW_HEIGHT_PX }}>
              {Array.from({ length: HOURS_PER_DAY - 1 }).map((_, i) => (
                <div key={i} className="pointer-events-none absolute left-0 right-0 border-t border-tj-black/5" style={{ top: (i + 1) * ROW_HEIGHT_PX }} />
              ))}
              {dayBlocks.map((b) => {
                const bs = new Date(b.start_at);
                const be = new Date(b.end_at);
                const offset = hoursOffsetInDay(bs, dayStartUtc) - DAY_START_HOUR;
                const durHours = (be.getTime() - bs.getTime()) / (1000 * 60 * 60);
                const topPx = Math.max(0, offset * ROW_HEIGHT_PX);
                const heightPx = Math.max(18, durHours * ROW_HEIGHT_PX);
                return (
                  <BlockCard key={b.id} block={b} teamName={b.team_id ? teamNameById.get(b.team_id) ?? null : null} topPx={topPx} heightPx={heightPx} weekParam={weekParam} readonly={readonly} />
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
