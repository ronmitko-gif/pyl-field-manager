import { createAdminClient } from '@/lib/supabase/admin';
import { FieldCard } from '../_components/field-card';

export default async function FieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ unmapped?: string }>;
}) {
  const params = await searchParams;
  const unmapped = params.unmapped ? decodeURIComponent(params.unmapped) : null;

  const admin = createAdminClient();
  const { data: fields } = await admin
    .from('fields')
    .select('id, name, short_name, park, sports_connect_description, has_lights, notes')
    .order('name');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Fields</h2>
        <p className="text-sm opacity-70">
          Edit the Sports Connect description so iCal events match the right field.
          No fields can be added or removed from this page.
        </p>
      </header>

      {unmapped && (
        <div className="rounded border border-tj-gold bg-tj-gold-soft/40 p-3 text-sm">
          <p className="font-semibold">Recent sync found an unmapped DESCRIPTION:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-xs">
            {unmapped}
          </code>
          <p className="mt-2 opacity-80">
            Paste this string into the right field&apos;s Sports Connect description,
            then click Save and re-run the rec sync.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {(fields ?? []).map((f) => (
          <FieldCard key={f.id} field={f} />
        ))}
      </div>
    </div>
  );
}
