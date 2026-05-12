'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fromZonedTime } from 'date-fns-tz';

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  const admin = createAdminClient();
  const { data: coach } = await admin
    .from('coaches')
    .select('id, org_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!coach || coach.role !== 'admin') throw new Error('unauthorized');
  return { adminClient: admin, coach };
}

export async function createTournamentEvent(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { adminClient, coach } = await requireAdmin();
  const date = String(formData.get('event_date') ?? '');
  const startHour = Number(formData.get('start_hour') ?? '0');
  const endHour = Number(formData.get('end_hour') ?? '0');
  const capacity = Math.min(20, Math.max(1, Number(formData.get('capacity') ?? '2')));

  if (!date) return { ok: false, error: 'Pick a date' };
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return { ok: false, error: 'Start hour 0–23' };
  if (!Number.isInteger(endHour) || endHour <= startHour || endHour > 24) return { ok: false, error: 'End hour must be after start hour' };

  const { data: ev, error: insErr } = await adminClient
    .from('concession_events')
    .insert({ org_id: coach.org_id, event_date: date, event_type: 'tournament' })
    .select('id')
    .single();
  if (insErr || !ev) {
    if (insErr?.code === '23505') return { ok: false, error: 'A tournament already exists on that date' };
    return { ok: false, error: insErr?.message ?? 'Insert failed' };
  }

  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    const start = fromZonedTime(`${date}T${String(h).padStart(2, '0')}:00:00`, 'America/New_York');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    slots.push({ event_id: ev.id, start_at: start.toISOString(), end_at: end.toISOString(), capacity });
  }
  if (slots.length > 0) await adminClient.from('concession_slots').insert(slots);

  revalidatePath('/admin/concessions');
  revalidatePath('/concessions');
  redirect(`/admin/concessions/${ev.id}`);
}

export async function removeSignup(formData: FormData): Promise<void> {
  const { adminClient } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing signup id');
  const { error } = await adminClient
    .from('concession_signups')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/concessions');
}
