import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays } from 'date-fns';
import type { TravelRecurringSlot, MaterializedBlock } from '@/lib/types';
import { materializeSlot } from './materialize';

type IngestCounts = {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
  errors: { source_uid: string; message: string }[];
};

export async function ingestTravelSlots(
  supabase: SupabaseClient,
  orgId: string,
  windowDays: number = 56
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    seen: 0, inserted: 0, updated: 0, unchanged: 0, deleted: 0, errors: [],
  };

  const windowStart = new Date();
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd = addDays(windowStart, windowDays);

  const { data: slotRows, error: slotErr } = await supabase
    .from('travel_recurring_slots')
    .select(`id, team_id, field_id, day_of_week, start_time, end_time, effective_from, effective_to, teams!inner(org_id)`)
    .eq('teams.org_id', orgId);
  if (slotErr) throw new Error(`Load slots failed: ${slotErr.message}`);
  const slots = (slotRows ?? []) as unknown as TravelRecurringSlot[];

  const desired: MaterializedBlock[] = [];
  for (const slot of slots) {
    desired.push(...materializeSlot(slot, orgId, windowStart, windowEnd));
  }
  counts.seen = desired.length;

  const { data: existing, error: exErr } = await supabase
    .from('schedule_blocks')
    .select('id, source_uid, start_at, end_at, team_id, field_id')
    .eq('source', 'travel_recurring')
    .eq('org_id', orgId)
    .gte('start_at', windowStart.toISOString())
    .lt('start_at', windowEnd.toISOString());
  if (exErr) throw new Error(`Load existing failed: ${exErr.message}`);

  const existingByUid = new Map((existing ?? []).map((r) => [r.source_uid as string, r]));
  const desiredUids = new Set(desired.map((d) => d.source_uid));

  for (const d of desired) {
    const payload = {
      org_id: d.org_id,
      team_id: d.team_id,
      field_id: d.field_id,
      start_at: d.start_at.toISOString(),
      end_at: d.end_at.toISOString(),
      source: 'travel_recurring' as const,
      source_uid: d.source_uid,
      status: 'confirmed' as const,
    };
    const prev = existingByUid.get(d.source_uid);
    if (!prev) {
      const { error } = await supabase.from('schedule_blocks').insert(payload);
      if (error) counts.errors.push({ source_uid: d.source_uid, message: error.message });
      else counts.inserted += 1;
    } else {
      const needsUpdate =
        prev.start_at !== payload.start_at ||
        prev.end_at !== payload.end_at ||
        prev.team_id !== payload.team_id ||
        prev.field_id !== payload.field_id;
      if (needsUpdate) {
        const { error } = await supabase
          .from('schedule_blocks')
          .update({
            start_at: payload.start_at,
            end_at: payload.end_at,
            team_id: payload.team_id,
            field_id: payload.field_id,
          })
          .eq('id', prev.id);
        if (error) counts.errors.push({ source_uid: d.source_uid, message: error.message });
        else counts.updated += 1;
      } else {
        counts.unchanged += 1;
      }
    }
  }

  const staleIds = (existing ?? [])
    .filter((r) => !desiredUids.has(r.source_uid as string))
    .map((r) => r.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from('schedule_blocks').delete().in('id', staleIds);
    if (error) counts.errors.push({ source_uid: '(bulk-delete)', message: error.message });
    else counts.deleted = staleIds.length;
  }

  return counts;
}
