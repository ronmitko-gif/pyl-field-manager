'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

export async function createCoach(formData: FormData) {
  const { adminClient, coach: admin } = await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'coach') === 'admin' ? 'admin' : 'coach';
  const teamIdRaw = String(formData.get('team_id') ?? '');
  const team_id = teamIdRaw || null;
  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const phone = phoneRaw || null;

  if (!name) throw new Error('Name is required');
  if (!email) throw new Error('Email is required');

  const { error } = await adminClient.from('coaches').insert({
    org_id: admin.org_id,
    name,
    email,
    role,
    team_id,
    phone,
  });

  if (error) {
    if (error.code === '23505') {
      throw new Error('A coach with that email already exists.');
    }
    throw new Error(`Insert failed: ${error.message}`);
  }

  revalidatePath('/admin/coaches');
  redirect('/admin/coaches');
}

export async function updateCoach(formData: FormData) {
  const { adminClient } = await requireAdmin();

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing coach id');

  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? 'coach') === 'admin' ? 'admin' : 'coach';
  const teamIdRaw = String(formData.get('team_id') ?? '');
  const team_id = teamIdRaw || null;
  const phoneRaw = String(formData.get('phone') ?? '').trim();
  const phone = phoneRaw || null;

  const { data: existing } = await adminClient
    .from('coaches')
    .select('email, auth_user_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) throw new Error('Coach not found');

  const patch: Record<string, unknown> = { name, role, team_id, phone };
  if (!existing.auth_user_id) {
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    if (email) patch.email = email;
  }

  const { error } = await adminClient.from('coaches').update(patch).eq('id', id);
  if (error) {
    if (error.code === '23505') {
      throw new Error('A coach with that email already exists.');
    }
    throw new Error(`Update failed: ${error.message}`);
  }

  revalidatePath('/admin/coaches');
  revalidatePath(`/admin/coaches/${id}`);
  redirect('/admin/coaches');
}
