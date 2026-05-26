import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedEvent } from '@/lib/types';
import { notifyTravelOverridden } from '@/lib/notifications/enqueue';

type IngestCounts = {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
  auto_overrides: number;
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
    auto_overrides: 0,
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

    // Sports Connect signals cancellation by prefixing the SUMMARY with "CANCELED-".
    // The event stays in the feed with the same data otherwise.
    const isCancelled = /^CANCELED-/i.test(ev.summary ?? '');
    const awayClean = isCancelled
      ? (ev.away_team_raw ?? '').replace(/^CANCELED-/i, '').trim()
      : ev.away_team_raw;

    const payload = {
      org_id: orgId,
      field_id: fieldId,
      start_at: ev.start_at.toISOString(),
      end_at: ev.end_at.toISOString(),
      source: 'sports_connect' as const,
      source_uid: ev.uid,
      home_team_raw: ev.home_team_raw,
      away_team_raw: awayClean,
      status: (isCancelled ? 'cancelled' : 'confirmed') as 'cancelled' | 'confirmed',
      raw_summary: ev.summary,
      raw_description: ev.description,
    };

    if (!existing) {
      // Natural-key dedup: Sports Connect rotates UIDs on every edit, so a "new"
      // UID often points at a game we already have. Match on
      // (field_id, start_at, home_team_raw, away_team_raw) — if those line up,
      // it's the same real-world game; update the existing row's UID instead
      // of inserting a duplicate.
      if (payload.home_team_raw && payload.away_team_raw) {
        const { data: byKey } = await supabase
          .from('schedule_blocks')
          .select('id')
          .eq('source', 'sports_connect')
          .eq('field_id', fieldId)
          .eq('start_at', payload.start_at)
          .eq('home_team_raw', payload.home_team_raw)
          .eq('away_team_raw', payload.away_team_raw)
          .limit(1)
          .maybeSingle();
        if (byKey) {
          const { error: updErr } = await supabase
            .from('schedule_blocks').update(payload).eq('id', byKey.id);
          if (updErr) {
            counts.errors.push({ uid: ev.uid, message: `Re-ticket update failed: ${updErr.message}` });
          } else {
            counts.updated += 1;
          }
          continue;
        }
      }

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
  // 90-day look-back: Sports Connect keeps historical games in the feed and
  // rotates UIDs on every edit. A short cutoff lets past-game duplicates
  // accumulate. 90 days covers a full season without risk of purging data
  // we might still care about.
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);

  // Paginate the scan: Supabase caps SELECT at 1000 rows by default. With
  // accumulated duplicates we can easily exceed that, leaving stale UIDs
  // un-cleaned and growing the table indefinitely.
  const PAGE = 1000;
  const staleIds: string[] = [];
  let scanErr: string | null = null;
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const { data: page, error } = await supabase
      .from('schedule_blocks')
      .select('id, source_uid')
      .eq('source', 'sports_connect')
      .eq('org_id', orgId)
      .gte('start_at', cutoff.toISOString())
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) { scanErr = error.message; break; }
    if (!page || page.length === 0) break;
    for (const r of page) {
      if (!feedUids.has(r.source_uid as string)) staleIds.push(r.id);
    }
    if (page.length < PAGE) break;
  }
  if (scanErr) {
    counts.errors.push({ uid: '(stale-scan)', message: scanErr });
  } else if (staleIds.length > 0) {
    const DEL_BATCH = 500;
    let totalDeleted = 0;
    for (let i = 0; i < staleIds.length; i += DEL_BATCH) {
      const batch = staleIds.slice(i, i + DEL_BATCH);
      const { error: delErr } = await supabase
        .from('schedule_blocks').delete().in('id', batch);
      if (delErr) {
        counts.errors.push({ uid: '(bulk-delete)', message: delErr.message });
        break;
      }
      totalDeleted += batch.length;
    }
    counts.deleted = totalDeleted;
  }

  // Auto-override: find future confirmed travel/manual blocks that overlap
  // confirmed sports_connect blocks on the same field, mark them overridden
  // and notify the team's coaches. Runs AFTER stale cleanup so we only
  // process blocks from the current feed.
  const nowIso = new Date().toISOString();
  const { data: recBlocks, error: recErr } = await supabase
    .from('schedule_blocks')
    .select('id, field_id, start_at, end_at, home_team_raw, away_team_raw, raw_summary')
    .eq('source', 'sports_connect')
    .eq('org_id', orgId)
    .eq('status', 'confirmed')
    .gte('start_at', nowIso);
  const { data: travelBlocks, error: travelErr } = await supabase
    .from('schedule_blocks')
    .select('id, field_id, team_id, start_at, end_at, org_id')
    .in('source', ['travel_recurring', 'manual'])
    .eq('org_id', orgId)
    .eq('status', 'confirmed')
    .gte('start_at', nowIso);
  if (recErr || travelErr) {
    counts.errors.push({
      uid: '(auto-override-scan)',
      message: `Load failed: ${recErr?.message ?? travelErr?.message ?? 'unknown'}`,
    });
    return counts;
  }

  for (const rec of recBlocks ?? []) {
    const recStart = new Date(rec.start_at).getTime();
    const recEnd = new Date(rec.end_at).getTime();
    const overlaps = (travelBlocks ?? []).filter((tb) => {
      if (tb.field_id !== rec.field_id) return false;
      const ts = new Date(tb.start_at).getTime();
      const te = new Date(tb.end_at).getTime();
      return ts < recEnd && te > recStart;
    });

    for (const travel of overlaps) {
      const matchup =
        rec.away_team_raw && rec.home_team_raw
          ? `${rec.away_team_raw} @ ${rec.home_team_raw}`
          : rec.raw_summary ?? 'Rec makeup';
      const reason = `Auto-override: rec game ${matchup}`;

      const { error: updErr } = await supabase
        .from('schedule_blocks')
        .update({
          status: 'overridden',
          overridden_by_block_id: rec.id,
          override_reason: reason,
        })
        .eq('id', travel.id);
      if (updErr) {
        counts.errors.push({
          uid: `(auto-override:${travel.id})`,
          message: updErr.message,
        });
        continue;
      }
      counts.auto_overrides += 1;

      if (travel.team_id) {
        const { data: coaches } = await supabase
          .from('coaches')
          .select('id, name, email, phone, team_id')
          .eq('team_id', travel.team_id);
        const { data: field } = await supabase
          .from('fields')
          .select('name')
          .eq('id', travel.field_id)
          .maybeSingle();
        if (coaches && coaches.length > 0 && field) {
          await notifyTravelOverridden(
            supabase,
            orgId,
            {
              id: travel.id,
              start_at: travel.start_at,
              end_at: travel.end_at,
              field_id: travel.field_id,
            },
            rec.id,
            reason,
            coaches.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email,
              phone: c.phone,
              team_id: c.team_id,
            })),
            field.name
          );
        }
      }
    }
  }

  return counts;
}
