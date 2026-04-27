'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateSlotRequest } from '@/lib/requests/validate';
import { notifyRequestSubmitted } from '@/lib/notifications/enqueue';

async function requireCoach() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  const admin = createAdminClient();
  const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, role, team_id, name, email, phone')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!coach) throw new Error('unauthorized');
  return { adminClient: admin, coach };
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

export async function submitSlotRequest(formData: FormData): Promise<SubmitResult> {
  const { adminClient, coach } = await requireCoach();
  if (!coach.team_id) {
    return { ok: false, error: 'You must be assigned to a team before requesting a slot.' };
  }

  const fieldId = String(formData.get('field_id') ?? '');
  const date = String(formData.get('date') ?? '');
  const startHms = String(formData.get('start_time') ?? '');
  const durationMin = Number(formData.get('duration_minutes') ?? '0');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!fieldId || !date || !startHms || !durationMin) {
    return { ok: false, error: 'Pick a field, date, start time, and duration.' };
  }

  const { fromZonedTime } = await import('date-fns-tz');
  const startAt = fromZonedTime(`${date}T${startHms}`, 'America/New_York');
  const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

  const validation = await validateSlotRequest(adminClient, coach.org_id, {
    field_id: fieldId,
    start_at: startAt,
    end_at: endAt,
    requester_coach_id: coach.id,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.reason };
  }

  const { data: reqRow, error } = await adminClient
    .from('slot_requests')
    .insert({
      org_id: coach.org_id,
      requesting_team_id: coach.team_id,
      requester_coach_id: coach.id,
      field_id: fieldId,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      status: 'pending',
      admin_note: note,
    })
    .select('id, start_at, end_at, field_id, requester_coach_id, admin_note')
    .single();
  if (error || !reqRow) {
    return { ok: false, error: `Could not save the request: ${error?.message ?? 'unknown'}` };
  }

  const { data: field } = await adminClient.from('fields').select('name').eq('id', fieldId).maybeSingle();
  const { data: team } = await adminClient.from('teams').select('name').eq('id', coach.team_id).maybeSingle();

  await notifyRequestSubmitted(
    adminClient,
    coach.org_id,
    reqRow,
    coach,
    field?.name ?? 'Unknown field',
    team?.name ?? 'Unknown team'
  );

  revalidatePath('/coach');
  revalidatePath('/admin/requests');
  revalidatePath('/admin');
  return { ok: true };
}

export async function withdrawSlotRequest(formData: FormData) {
  const { adminClient, coach } = await requireCoach();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing request id');

  const { error } = await adminClient
    .from('slot_requests')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('requester_coach_id', coach.id)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);

  revalidatePath('/coach');
  revalidatePath('/admin/requests');
}

export async function cancelOwnBlock(formData: FormData) {
  const { adminClient, coach } = await requireCoach();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing block id');

  const { data: block } = await adminClient
    .from('schedule_blocks')
    .select('id, team_id, start_at, status')
    .eq('id', id)
    .maybeSingle();
  if (!block) throw new Error('Block not found');
  if (block.team_id !== coach.team_id) throw new Error('Not your team');
  if (new Date(block.start_at) < new Date()) throw new Error('Cannot cancel past blocks');

  const { error } = await adminClient
    .from('schedule_blocks')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/coach');
  revalidatePath('/admin');
}
