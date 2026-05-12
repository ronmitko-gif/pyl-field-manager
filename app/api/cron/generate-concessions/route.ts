import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateConcessionSlots } from '@/lib/concessions/generate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: org } = await admin
    .from('organizations').select('id').eq('slug', 'tjybb').single();
  if (!org) return NextResponse.json({ error: 'org missing' }, { status: 500 });

  const { data: frontField } = await admin
    .from('fields').select('id').eq('name', '885 Front Field').maybeSingle();
  if (!frontField) {
    return NextResponse.json({ error: 'Front field not found' }, { status: 500 });
  }

  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 14);

  const { data: games } = await admin
    .from('schedule_blocks')
    .select('id, field_id, source_uid, start_at, end_at, status')
    .eq('source', 'sports_connect')
    .eq('field_id', frontField.id)
    .neq('status', 'cancelled')
    .gte('start_at', new Date().toISOString())
    .lt('start_at', horizon.toISOString());

  const generated = generateConcessionSlots(
    (games ?? []).map((g) => ({
      id: g.id,
      field_id: g.field_id,
      source_uid: g.source_uid ?? g.id,
      start_at: g.start_at,
      end_at: g.end_at,
    })),
    org.id
  );

  let eventsInserted = 0;
  let slotsInserted = 0;

  for (const ev of generated) {
    const { data: existing } = await admin
      .from('concession_events')
      .select('id, source_game_ids')
      .eq('org_id', ev.org_id)
      .eq('event_date', ev.event_date)
      .eq('event_type', ev.event_type)
      .maybeSingle();

    if (existing) {
      const newIds = ev.source_game_ids.sort();
      const oldIds = (existing.source_game_ids ?? []).slice().sort();
      if (JSON.stringify(newIds) !== JSON.stringify(oldIds)) {
        await admin
          .from('concession_events')
          .update({ source_game_ids: ev.source_game_ids })
          .eq('id', existing.id);
      }
      continue;
    }

    const { data: row } = await admin
      .from('concession_events')
      .insert({
        org_id: ev.org_id,
        event_date: ev.event_date,
        event_type: ev.event_type,
        source_game_ids: ev.source_game_ids,
      })
      .select('id')
      .single();
    if (!row) continue;
    eventsInserted += 1;

    for (const s of ev.slots) {
      const { error } = await admin.from('concession_slots').insert({
        event_id: row.id,
        start_at: s.start_at.toISOString(),
        end_at: s.end_at.toISOString(),
        capacity: s.capacity,
      });
      if (!error) slotsInserted += 1;
    }
  }

  return NextResponse.json({ ok: true, events_inserted: eventsInserted, slots_inserted: slotsInserted });
}

export async function GET(req: Request) {
  return POST(req);
}
