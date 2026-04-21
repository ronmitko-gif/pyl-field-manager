'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const EDITABLE_STATUSES = new Set(['confirmed', 'cancelled', 'tentative']);

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

export async function updateBlock(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const notesRaw = formData.get('notes');
  const notes = notesRaw === null ? null : String(notesRaw).slice(0, 500) || null;

  if (!id) throw new Error('Missing block id');
  if (!EDITABLE_STATUSES.has(status)) {
    throw new Error(`Status "${status}" is not editable here`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('schedule_blocks')
    .update({ status, notes })
    .eq('id', id);
  if (error) throw new Error(`Update failed: ${error.message}`);

  revalidatePath('/admin');
}

export async function updateField(formData: FormData) {
  const { adminClient } = await requireAdmin();

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing field id');

  const scDesc = formData.get('sports_connect_description');
  const hasLights = formData.get('has_lights') === 'on';
  const notesRaw = formData.get('notes');

  const patch = {
    sports_connect_description:
      scDesc === null ? null : String(scDesc).trim() || null,
    has_lights: hasLights,
    notes: notesRaw === null ? null : String(notesRaw).slice(0, 500) || null,
  };

  const { error } = await adminClient.from('fields').update(patch).eq('id', id);
  if (error) throw new Error(`Update failed: ${error.message}`);

  revalidatePath('/admin/fields');
  revalidatePath('/admin');
}
