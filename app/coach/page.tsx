import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ScheduleBlock } from '@/lib/types';
import type { OpenWindow } from '@/lib/requests/windows';
import { RequestForm } from './_components/request-form';
import { UpcomingBlockRow } from './_components/upcoming-block-row';
import { PendingRequestRow } from './_components/pending-request-row';

export default async function CoachPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, name, email, team_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!coach) redirect('/login');

  const { data: team } = coach.team_id
    ? await admin.from('teams').select('name').eq('id', coach.team_id).maybeSingle()
    : { data: null };

  const fourWeeksOut = new Date();
  fourWeeksOut.setUTCDate(fourWeeksOut.getUTCDate() + 28);

  const teamIdFilter = coach.team_id ?? '00000000-0000-0000-0000-000000000000';

  const [blocksRes, fieldsRes, windowsRes, requestsRes] = await Promise.all([
    admin
      .from('schedule_blocks')
      .select('*')
      .eq('team_id', teamIdFilter)
      .gte('start_at', new Date().toISOString())
      .lte('start_at', fourWeeksOut.toISOString())
      .order('start_at')
      .limit(100),
    admin.from('fields').select('id, name').order('name'),
    admin
      .from('open_windows')
      .select('id, field_id, day_of_week, start_time, end_time')
      .eq('org_id', coach.org_id),
    admin
      .from('slot_requests')
      .select('id, start_at, end_at, field_id, admin_note, status')
      .eq('requester_coach_id', coach.id)
      .eq('status', 'pending')
      .order('start_at'),
  ]);

  const blocks = (blocksRes.data ?? []) as ScheduleBlock[];
  const fields = fieldsRes.data ?? [];
  const fieldNameById = new Map(fields.map((f) => [f.id, f.name]));
  const windows = (windowsRes.data ?? []) as OpenWindow[];
  const requests = requestsRes.data ?? [];

  async function signOut() {
    'use server';
    const s = await createClient();
    await s.auth.signOut();
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="flex items-center justify-between border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <div>
          <div className="text-xs uppercase tracking-wide text-tj-gold">{team?.name ?? 'No team assigned'}</div>
          <h1 className="text-lg font-semibold">Welcome, {coach.name}</h1>
        </div>
        <form action={signOut}>
          <button className="text-sm text-tj-gold-soft hover:text-tj-gold underline underline-offset-4">Sign out</button>
        </form>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-tj-black/60">Your upcoming blocks</h2>
          {blocks.length === 0 ? (
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No upcoming practices. Request a slot below.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {blocks.map((b) => (
                <UpcomingBlockRow key={b.id} block={b} fieldName={fieldNameById.get(b.field_id) ?? ''} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-tj-black/60">Request a slot</h2>
          <div className="rounded-lg border border-tj-black/10 bg-white p-4">
            <RequestForm fields={fields} windows={windows} />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-tj-black/60">Your pending requests</h2>
          {requests.length === 0 ? (
            <p className="rounded border border-tj-black/10 bg-white p-4 text-sm text-tj-black/50">
              No pending requests.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {requests.map((r) => (
                <PendingRequestRow key={r.id} request={r} fieldName={fieldNameById.get(r.field_id) ?? ''} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
