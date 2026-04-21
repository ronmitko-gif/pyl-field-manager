import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedEvent } from '@/lib/types';

type IngestCounts = {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
  errors: { uid: string; message: string }[];
};

export async function ingestEvents(
  supabase: SupabaseClient,
  orgId: string,
  events: NormalizedEvent[]
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    seen: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    errors: [],
  };

  const { data: fields, error: fieldsErr } = await supabase
    .from('fields')
    .select('id, sports_connect_description, org_id')
    .eq('org_id', orgId);
  if (fieldsErr) throw new Error(`Load fields failed: ${fieldsErr.message}`);

  const fieldByDesc = new Map<string, string>();
  for (const f of fields ?? []) {
    if (f.sports_connect_description) {
      fieldByDesc.set(f.sports_connect_description, f.id);
    }
  }

  for (const ev of events) {
    counts.seen += 1;
    const fieldId = fieldByDesc.get(ev.description);
    if (!fieldId) {
      counts.errors.push({
        uid: ev.uid,
        message: `No field match for DESCRIPTION="${ev.description}"`,
      });
      continue;
    }

    const { data: existing, error: selErr } = await supabase
      .from('schedule_blocks')
      .select('id, start_at, end_at, raw_summary, raw_description, status')
      .eq('source', 'sports_connect')
      .eq('source_uid', ev.uid)
      .maybeSingle();
    if (selErr) {
      counts.errors.push({ uid: ev.uid, message: `Lookup failed: ${selErr.message}` });
      continue;
    }

    const payload = {
      org_id: orgId,
      field_id: fieldId,
      start_at: ev.start_at.toISOString(),
      end_at: ev.end_at.toISOString(),
      source: 'sports_connect' as const,
      source_uid: ev.uid,
      home_team_raw: ev.home_team_raw,
      away_team_raw: ev.away_team_raw,
      status: 'confirmed' as const,
      raw_summary: ev.summary,
      raw_description: ev.description,
    };

    if (!existing) {
      const { error: insErr } = await supabase
        .from('schedule_blocks')
        .insert(payload);
      if (insErr) {
        counts.errors.push({ uid: ev.uid, message: `Insert failed: ${insErr.message}` });
      } else {
        counts.inserted += 1;
      }
      continue;
    }

    const needsUpdate =
      existing.start_at !== payload.start_at ||
      existing.end_at !== payload.end_at ||
      existing.raw_summary !== payload.raw_summary ||
      existing.raw_description !== payload.raw_description;

    if (!needsUpdate) {
      counts.unchanged += 1;
      continue;
    }

    const { error: updErr } = await supabase
      .from('schedule_blocks')
      .update(payload)
      .eq('id', existing.id);
    if (updErr) {
      counts.errors.push({ uid: ev.uid, message: `Update failed: ${updErr.message}` });
    } else {
      counts.updated += 1;
    }
  }

  // Remove any future sports_connect blocks whose UID isn't in the current feed.
  // Sports Connect rotates UIDs when events are edited or cancelled, so anything
  // not in the latest feed is either genuinely cancelled or a stale duplicate
  // from a prior edit.
  const feedUids = new Set(events.map((e) => e.uid));
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - 1); // 1-day safety window

  const { data: existingSports, error: exErr } = await supabase
    .from('schedule_blocks')
    .select('id, source_uid')
    .eq('source', 'sports_connect')
    .eq('org_id', orgId)
    .gte('start_at', cutoff.toISOString());
  if (exErr) {
    counts.errors.push({ uid: '(stale-scan)', message: exErr.message });
  } else {
    const staleIds = (existingSports ?? [])
      .filter((r) => !feedUids.has(r.source_uid as string))
      .map((r) => r.id);
    if (staleIds.length > 0) {
      const { error: delErr } = await supabase
        .from('schedule_blocks')
        .delete()
        .in('id', staleIds);
      if (delErr) {
        counts.errors.push({ uid: '(bulk-delete)', message: delErr.message });
      } else {
        counts.deleted = staleIds.length;
      }
    }
  }

  return counts;
}
