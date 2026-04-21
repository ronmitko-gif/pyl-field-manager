'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  notifyRequestApproved,
  notifyRequestDenied,
} from '@/lib/notifications/enqueue';

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

type SlotRequestRow = {
  id: string;
  org_id: string;
  requesting_team_id: string;
  requester_coach_id: string;
  requested_block_id: string | null;
  field_id: string;
  start_at: string;
  end_at: string;
  admin_note: string | null;
  status: string;
};

async function loadRequest(
  admin: ReturnType<typeof createAdminClient>,
  id: string
): Promise<SlotRequestRow | null> {
  const { data } = await admin
    .from('slot_requests')
    .select('id, org_id, requesting_team_id, requester_coach_id, field_id, start_at, end_at, admin_note, status, requested_block_id')
    .eq('id', id)
    .maybeSingle();
  return (data as SlotRequestRow | null) ?? null;
}

export async function approveSlotRequest(formData: FormData) {
  const { adminClient } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const adminNote = String(formData.get('admin_note') ?? '').trim() || null;
  if (!id) throw new Error('Missing request id');

  const request = await loadRequest(adminClient, id);
  if (!request) throw new Error('Request not found');
  if (request.status !== 'pending') throw new Error('Request is not pending');

  const { data: block, error: insErr } = await adminClient
    .from('schedule_blocks')
    .insert({
      org_id: request.org_id,
      field_id: request.field_id,
      team_id: request.requesting_team_id,
      source: 'manual',
      status: 'confirmed',
      start_at: request.start_at,
      end_at: request.end_at,
      notes: request.admin_note,
    })
    .select('id')
    .single();
  if (insErr || !block) throw new Error(`Block insert failed: ${insErr?.message ?? 'unknown'}`);

  await adminClient
    .from('slot_requests')
    .update({
      status: 'approved',
      admin_note: adminNote ?? request.admin_note,
      resolved_at: new Date().toISOString(),
      requested_block_id: block.id,
    })
    .eq('id', id);

  const { data: pending } = await adminClient
    .from('slot_requests')
    .select('id, org_id, requester_coach_id, field_id, start_at, end_at, admin_note, requesting_team_id, status, requested_block_id')
    .eq('field_id', request.field_id)
    .eq('status', 'pending');

  const startMs = new Date(request.start_at).getTime();
  const endMs = new Date(request.end_at).getTime();
  const superseded = (pending ?? []).filter((p) => {
    if (p.id === id) return false;
    const ps = new Date(p.start_at).getTime();
    const pe = new Date(p.end_at).getTime();
    return ps < endMs && pe > startMs;
  });

  for (const s of superseded) {
    await adminClient
      .from('slot_requests')
      .update({
        status: 'denied',
        admin_note: 'superseded',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', s.id);
  }

  const { data: requester } = await adminClient
    .from('coaches')
    .select('id, name, email, phone, team_id')
    .eq('id', request.requester_coach_id)
    .maybeSingle();
  const { data: field } = await adminClient
    .from('fields')
    .select('name')
    .eq('id', request.field_id)
    .maybeSingle();

  if (requester?.email && field) {
    await notifyRequestApproved(
      adminClient,
      request.org_id,
      { ...request, admin_note: adminNote },
      { id: requester.id, name: requester.name, email: requester.email, phone: requester.phone, team_id: requester.team_id },
      field.name,
      block.id
    );
  }

  for (const s of superseded) {
    const { data: sCoach } = await adminClient
      .from('coaches')
      .select('id, name, email, phone, team_id')
      .eq('id', s.requester_coach_id)
      .maybeSingle();
    if (sCoach?.email && field) {
      await notifyRequestDenied(
        adminClient,
        request.org_id,
        {
          id: s.id,
          start_at: s.start_at,
          end_at: s.end_at,
          field_id: s.field_id,
          requester_coach_id: s.requester_coach_id,
          admin_note: 'superseded',
        },
        { id: sCoach.id, name: sCoach.name, email: sCoach.email, phone: sCoach.phone, team_id: sCoach.team_id },
        field.name,
        true
      );
    }
  }

  revalidatePath('/admin/requests');
  revalidatePath('/admin');
  revalidatePath('/coach');
}

export async function denySlotRequest(formData: FormData) {
  const { adminClient } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const adminNote = String(formData.get('admin_note') ?? '').trim() || null;
  if (!id) throw new Error('Missing request id');

  const request = await loadRequest(adminClient, id);
  if (!request) throw new Error('Request not found');
  if (request.status !== 'pending') throw new Error('Request is not pending');

  await adminClient
    .from('slot_requests')
    .update({
      status: 'denied',
      admin_note: adminNote,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id);

  const { data: requester } = await adminClient
    .from('coaches')
    .select('id, name, email, phone, team_id')
    .eq('id', request.requester_coach_id)
    .maybeSingle();
  const { data: field } = await adminClient
    .from('fields')
    .select('name')
    .eq('id', request.field_id)
    .maybeSingle();

  if (requester?.email && field) {
    await notifyRequestDenied(
      adminClient,
      request.org_id,
      { ...request, admin_note: adminNote },
      { id: requester.id, name: requester.name, email: requester.email, phone: requester.phone, team_id: requester.team_id },
      field.name
    );
  }

  revalidatePath('/admin/requests');
  revalidatePath('/admin');
  revalidatePath('/coach');
}
