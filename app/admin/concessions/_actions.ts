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
  const name = String(formData.get('name') ?? '').trim().slice(0, 120) || null;
  const startTime = String(formData.get('start_time') ?? '');
  const endTime = String(formData.get('end_time') ?? '');
  const slotMinutes = Number(formData.get('slot_minutes') ?? '30');
  const capacity = Math.min(20, Math.max(1, Number(formData.get('capacity') ?? '2')));

  // Parse "HH:MM" wall-clock (Eastern) into minutes-since-midnight.
  const parseMinutes = (t: string): number | null => {
    const m = /^(\d{2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };

  if (!date) return { ok: false, error: 'Pick a date' };
  const startMin = parseMinutes(startTime);
  const endMin = parseMinutes(endTime);
  if (startMin === null) return { ok: false, error: 'Invalid start time' };
  if (endMin === null || endMin <= startMin) return { ok: false, error: 'End time must be after start time' };
  if (![15, 30, 60].includes(slotMinutes)) return { ok: false, error: 'Slot length must be 15, 30, or 60 minutes' };
  if (startMin + slotMinutes > endMin) return { ok: false, error: 'Time window is shorter than one slot' };

  const { data: ev, error: insErr } = await adminClient
    .from('concession_events')
    .insert({ org_id: coach.org_id, event_date: date, event_type: 'tournament', name })
    .select('id')
    .single();
  if (insErr || !ev) {
    if (insErr?.code === '23505') return { ok: false, error: 'A tournament already exists on that date' };
    return { ok: false, error: insErr?.message ?? 'Insert failed' };
  }

  const slots = [];
  for (let t = startMin; t + slotMinutes <= endMin; t += slotMinutes) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    const start = fromZonedTime(`${date}T${hh}:${mm}:00`, 'America/New_York');
    const end = new Date(start.getTime() + slotMinutes * 60 * 1000);
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
