import { updateField } from '../_actions';

type Field = {
  id: string;
  name: string;
  short_name: string | null;
  park: string;
  sports_connect_description: string | null;
  has_lights: boolean;
  notes: string | null;
};

export function FieldCard({ field }: { field: Field }) {
  return (
    <article className="rounded-lg border border-tj-black/10 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">{field.name}</h3>
          <p className="text-xs opacity-60">
            {field.park}
            {field.short_name ? ` · ${field.short_name}` : null}
          </p>
        </div>
      </header>

      <form action={updateField} className="flex flex-col gap-3 text-sm">
        <input type="hidden" name="id" value={field.id} />

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">
            Sports Connect description
          </span>
          <input
            type="text"
            name="sports_connect_description"
            defaultValue={field.sports_connect_description ?? ''}
            placeholder="Andrew Reilly Memorial Park > 885 Back Field"
            className="rounded border border-tj-black/20 px-2 py-1"
          />
          <span className="text-xs opacity-60">
            Exact match for the DESCRIPTION field on Sports Connect iCal events.
            A trailing space or mismatched capitalization breaks the sync.
          </span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="has_lights"
            defaultChecked={field.has_lights}
            className="h-4 w-4"
          />
          <span className="text-sm">Has lights</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">
            Notes
          </span>
          <textarea
            name="notes"
            defaultValue={field.notes ?? ''}
            maxLength={500}
            rows={2}
            className="rounded border border-tj-black/20 px-2 py-1"
          />
        </label>

        <div>
          <button
            type="submit"
            className="rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80"
          >
            Save {field.name}
          </button>
        </div>
      </form>
    </article>
  );
}
