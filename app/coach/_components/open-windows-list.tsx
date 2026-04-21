import { formatInTimeZone } from 'date-fns-tz';
import type { WindowInstance } from '@/lib/requests/availability';

const TZ = 'America/New_York';

function fmtTime(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, 'h:mm a').toLowerCase();
}

function fmtWindow(hms: string): string {
  const [h, m] = hms.split(':').slice(0, 2).map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export function OpenWindowsList({
  instances,
  teamNameById,
  fieldNameById,
  limit = 5,
}: {
  instances: WindowInstance[];
  teamNameById: Map<string, string>;
  fieldNameById: Map<string, string>;
  limit?: number;
}) {
  const shown = instances.slice(0, limit);
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {shown.map((inst) => {
        const dateEt = new Date(`${inst.date}T12:00:00Z`);
        return (
          <li key={`${inst.field_id}-${inst.date}`} className="rounded border border-tj-black/10 bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-medium">
                {formatInTimeZone(dateEt, TZ, 'EEE MMM d')}
              </div>
              <div className="text-xs opacity-70">
                {fieldNameById.get(inst.field_id) ?? inst.field_id} · {fmtWindow(inst.window.start_time)} – {fmtWindow(inst.window.end_time)}
              </div>
            </div>
            {inst.taken.length > 0 ? (
              <div className="mt-1 text-xs opacity-70">
                <span className="font-medium">Taken:</span>{' '}
                {inst.taken.map((t, i) => (
                  <span key={t.id}>
                    {fmtTime(t.start_at)}–{fmtTime(t.end_at)}
                    {t.team_id && teamNameById.get(t.team_id)
                      ? ` (${teamNameById.get(t.team_id)})`
                      : ''}
                    {i < inst.taken.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-xs text-tj-gold">Fully available</div>
            )}
          </li>
        );
      })}
      {shown.length === 0 && (
        <li className="rounded border border-tj-black/10 bg-white p-3 text-sm text-tj-black/50">
          No open windows in the next 4 weeks.
        </li>
      )}
    </ul>
  );
}
