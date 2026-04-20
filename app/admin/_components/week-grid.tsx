import type { ScheduleBlock } from '@/lib/types';
import type { WeekBounds } from '@/lib/calendar/week';
import { FieldGrid } from './field-grid';

type Field = { id: string; name: string; short_name: string | null };
type Team = { id: string; name: string };

export function WeekGrid({
  week, fields, blocks, teams,
}: {
  week: WeekBounds;
  fields: Field[];
  blocks: ScheduleBlock[];
  teams: Team[];
}) {
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="hidden md:flex md:flex-col md:gap-4">
      {sorted.map((f) => (
        <FieldGrid
          key={f.id}
          fieldId={f.id}
          fieldName={f.name}
          weekStart={week.start}
          weekParam={week.param}
          blocks={blocks}
          teamNameById={teamNameById}
        />
      ))}
    </div>
  );
}
