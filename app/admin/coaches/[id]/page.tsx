import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { CoachForm } from '../../_components/coach-form';

export default async function EditCoachPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const [coachRes, teamsRes] = await Promise.all([
    admin
      .from('coaches')
      .select('id, name, email, role, team_id, phone, auth_user_id')
      .eq('id', id)
      .maybeSingle(),
    admin.from('teams').select('id, name').order('name'),
  ]);
  const coach = coachRes.data;
  if (!coach) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Edit coach</h2>
        <p className="text-sm opacity-70">
          {coach.auth_user_id
            ? 'This coach has already logged in — email is locked.'
            : 'This coach has not logged in yet — email can still be changed.'}
        </p>
      </header>
      <CoachForm mode="edit" teams={teamsRes.data ?? []} coach={coach} />
    </div>
  );
}
