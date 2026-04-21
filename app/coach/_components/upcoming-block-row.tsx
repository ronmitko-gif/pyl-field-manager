import { formatInTimeZone } from 'date-fns-tz';
import { cancelOwnBlock } from '../_actions';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

export function UpcomingBlockRow({
  block,
  fieldName,
}: {
  block: ScheduleBlock;
  fieldName: string;
}) {
  const start = new Date(block.start_at);
  const end = new Date(block.end_at);
  const isCancelled = block.status === 'cancelled';
  return (
    <li className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
      <div>
        <div className={`font-medium ${isCancelled ? 'line-through opacity-60' : ''}`}>
          {formatInTimeZone(start, TZ, 'EEE MMM d')} · {formatInTimeZone(start, TZ, 'h:mm a')}–{formatInTimeZone(end, TZ, 'h:mm a')}
        </div>
        <div className="text-xs opacity-70">{fieldName} · {block.source === 'manual' ? 'Requested' : 'Practice'}</div>
      </div>
      {!isCancelled && (
        <form action={cancelOwnBlock}>
          <input type="hidden" name="id" value={block.id} />
          <button className="text-xs underline hover:no-underline">Cancel</button>
        </form>
      )}
    </li>
  );
}
