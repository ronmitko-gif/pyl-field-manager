import { createAdminClient } from '@/lib/supabase/admin';
import { CoachForm } from '../../_components/coach-form';

export default async function NewCoachPage() {
  const admin = createAdminClient();
  const { data: teams } = await admin.from('teams').select('id, name').order('name');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Add coach</h2>
        <p className="text-sm opacity-70">
          Creates a coach row. The coach can log in immediately via magic link — their
          account gets linked on first login.
        </p>
      </header>
      <CoachForm mode="create" teams={teams ?? []} />
    </div>
  );
}
