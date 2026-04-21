import { formatInTimeZone } from 'date-fns-tz';
import type { WindowInstance } from '@/lib/requests/availability';

const TZ = 'America/New_York';

function fmtTime(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, 'h:mm a').toLowerCase();
}

const MIN_FREE_MINUTES = 60;

export function OpenWindowsList({
  instances,
  fieldNameById,
  limit = 5,
}: {
  instances: WindowInstance[];
  fieldNameById: Map<string, string>;
  limit?: number;
}) {
  const available = instances.filter((i) => i.freeMinutes >= MIN_FREE_MINUTES).slice(0, limit);
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {available.map((inst) => {
        const dateEt = new Date(`${inst.date}T12:00:00Z`);
        return (
          <li key={`${inst.field_id}-${inst.date}`} className="rounded border border-tj-black/10 bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-medium">
                {formatInTimeZone(dateEt, TZ, 'EEE MMM d')}
              </div>
              <div className="text-xs opacity-70">
                {fieldNameById.get(inst.field_id) ?? inst.field_id}
              </div>
            </div>
            <div className="mt-1 text-xs">
              <span className="font-medium text-tj-gold">Free:</span>{' '}
              {inst.free.map((r, i) => (
                <span key={r.start_at}>
                  {fmtTime(r.start_at)}–{fmtTime(r.end_at)}
                  {i < inst.free.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          </li>
        );
      })}
      {available.length === 0 && (
        <li className="rounded border border-tj-black/10 bg-white p-3 text-sm text-tj-black/50">
          No open windows with an hour or more free in the next 4 weeks.
        </li>
      )}
    </ul>
  );
}
