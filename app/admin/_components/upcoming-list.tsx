import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import type { ScheduleBlock } from '@/lib/types';

const TZ = 'America/New_York';

type Field = { id: string; name: string; short_name: string | null };
type Team = { id: string; name: string };

function label(b: ScheduleBlock, teamName: string | null): string {
  if (b.source === 'sports_connect' && b.away_team_raw && b.home_team_raw) {
    return `${b.away_team_raw} @ ${b.home_team_raw}`;
  }
  return teamName ?? b.raw_summary ?? 'Block';
}

export function UpcomingList({
  blocks, fields, teams, weekParam,
}: {
  blocks: ScheduleBlock[];
  fields: Field[];
  teams: Team[];
  weekParam: string;
}) {
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const fieldNameById = new Map(fields.map((f) => [f.id, f.short_name ?? f.name]));
  return (
    <section className="rounded-lg border border-tj-black/10 bg-white p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">Next 10 upcoming blocks</h3>
      {blocks.length === 0 ? (
        <p className="text-sm text-tj-black/50">Nothing scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {blocks.map((b) => (
            <li key={b.id}>
              <Link href={`?week=${weekParam}&block=${b.id}`} scroll={false} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-tj-cream">
                <span className="truncate">{label(b, b.team_id ? teamNameById.get(b.team_id) ?? null : null)}</span>
                <span className="ml-3 shrink-0 text-xs opacity-70">
                  {formatInTimeZone(new Date(b.start_at), TZ, 'EEE h:mm a')} · {fieldNameById.get(b.field_id) ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
