import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

type Field = { id: string; name: string; short_name: string | null };

export function OpenSlotsList({
  blocks, fields, weekParam,
}: {
  blocks: ScheduleBlock[];
  fields: Field[];
  weekParam: string;
}) {
  const fieldNameById = new Map(fields.map((f) => [f.id, f.short_name ?? f.name]));
  return (
    <section className="rounded-lg border border-tj-black/10 bg-white p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">Next 10 open slots</h3>
      {blocks.length === 0 ? (
        <p className="text-sm text-tj-black/50">No open slots available.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {blocks.map((b) => (
            <li key={b.id}>
              <Link href={`?week=${weekParam}&block=${b.id}`} scroll={false} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-tj-cream">
                <span className="truncate">Open slot</span>
                <span className="ml-3 shrink-0 text-xs opacity-70">
                  {formatInTimeZone(new Date(b.start_at), TZ, 'EEE MMM d, h:mm a')} · {fieldNameById.get(b.field_id) ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
