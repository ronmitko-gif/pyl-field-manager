import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpenWindow } from './windows';
import { windowsForDate, fitsInWindow } from './windows';

type Input = {
  field_id: string;
  start_at: Date;
  end_at: Date;
  requester_coach_id: string;
};

type ValidationResult = { ok: true } | { ok: false; reason: string };

const MAX_DURATION_MS = 3 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

export async function validateSlotRequest(
  admin: SupabaseClient,
  orgId: string,
  input: Input
): Promise<ValidationResult> {
  const { field_id, start_at, end_at, requester_coach_id } = input;

  if (end_at.getTime() <= start_at.getTime()) {
    return { ok: false, reason: 'End time must be after start time.' };
  }
  const durationMs = end_at.getTime() - start_at.getTime();
  if (durationMs > MAX_DURATION_MS) {
    return { ok: false, reason: 'Slots are capped at 3 hours.' };
  }
  if (start_at.getTime() % HALF_HOUR_MS !== 0) {
    return { ok: false, reason: 'Start must be on a 30-minute boundary.' };
  }
  if (end_at.getTime() % HALF_HOUR_MS !== 0) {
    return { ok: false, reason: 'End must be on a 30-minute boundary.' };
  }

  const { data: windowRows, error: winErr } = await admin
    .from('open_windows')
    .select('id, field_id, day_of_week, start_time, end_time')
    .eq('org_id', orgId);
  if (winErr) return { ok: false, reason: `Couldn't load open windows: ${winErr.message}` };
  const windows = (windowRows ?? []) as OpenWindow[];

  const dayWindows = windowsForDate(windows, field_id, start_at);
  const fits = dayWindows.some((w) => fitsInWindow(w, start_at, end_at));
  if (!fits) {
    return { ok: false, reason: 'This time is outside any open window for the field.' };
  }

  const { data: overlappingBlocks, error: blockErr } = await admin
    .from('schedule_blocks')
    .select('id, start_at, end_at, field_id, status')
    .eq('field_id', field_id)
    .in('status', ['confirmed', 'tentative']);
  if (blockErr) return { ok: false, reason: `Couldn't load existing blocks: ${blockErr.message}` };

  const overlaps = (overlappingBlocks ?? []).some((b) => {
    const bs = new Date(b.start_at).getTime();
    const be = new Date(b.end_at).getTime();
    return bs < end_at.getTime() && be > start_at.getTime();
  });
  if (overlaps) {
    return { ok: false, reason: 'That field is already booked during that time.' };
  }

  const { data: pending, error: pendErr } = await admin
    .from('slot_requests')
    .select('id, start_at, end_at, field_id, requester_coach_id')
    .eq('requester_coach_id', requester_coach_id)
    .eq('status', 'pending');
  if (pendErr) return { ok: false, reason: `Couldn't load pending requests: ${pendErr.message}` };

  const hasPendingOverlap = (pending ?? []).some((p) => {
    if (p.field_id !== field_id) return false;
    const ps = new Date(p.start_at).getTime();
    const pe = new Date(p.end_at).getTime();
    return ps < end_at.getTime() && pe > start_at.getTime();
  });
  if (hasPendingOverlap) {
    return { ok: false, reason: 'You already have a pending request that overlaps this time.' };
  }

  return { ok: true };
}
