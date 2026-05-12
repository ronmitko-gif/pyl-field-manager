import 'server-only';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateConcessionSlots } from '@/lib/concessions/generate';
import { sendEmail } from '@/lib/email/send';
import { cancellationEmail } from '@/lib/email/concession-templates';

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

  // ---- Auto-cancel dead game events ----
  // Find future game-type concession events whose source games are ALL cancelled
  // or missing. Cancel any active signups (email + soft-cancel) then delete the
  // event (cascades to slots).
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: futureGameEvents } = await admin
    .from('concession_events')
    .select('id, event_date, source_game_ids, location')
    .eq('org_id', org.id)
    .eq('event_type', 'game')
    .gte('event_date', todayIso);

  let eventsCancelled = 0;
  let signupsCancelled = 0;

  for (const ev of futureGameEvents ?? []) {
    const uids = ev.source_game_ids ?? [];
    if (uids.length === 0) continue;

    const { data: liveGames } = await admin
      .from('schedule_blocks')
      .select('source_uid')
      .eq('source', 'sports_connect')
      .neq('status', 'cancelled')
      .in('source_uid', uids);
    if ((liveGames?.length ?? 0) > 0) continue; // at least one game still on

    const { data: deadSlots } = await admin
      .from('concession_slots').select('id, start_at, end_at').eq('event_id', ev.id);
    const slotIds = (deadSlots ?? []).map((s) => s.id);
    const slotById = new Map((deadSlots ?? []).map((s) => [s.id, s]));

    const { data: activeSignups } = slotIds.length
      ? await admin
          .from('concession_signups')
          .select('id, slot_id, volunteer_name, volunteer_email')
          .is('cancelled_at', null)
          .in('slot_id', slotIds)
      : { data: [] };

    for (const su of activeSignups ?? []) {
      const slot = slotById.get(su.slot_id);
      if (!slot) continue;
      const tmpl = cancellationEmail({
        name: su.volunteer_name,
        start_at: slot.start_at,
        end_at: slot.end_at,
        location: ev.location,
      });
      await sendEmail({ to: su.volunteer_email, subject: tmpl.subject, html: tmpl.html });
      await admin
        .from('concession_signups')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('id', su.id);
      signupsCancelled += 1;
    }

    await admin.from('concession_events').delete().eq('id', ev.id);
    eventsCancelled += 1;
  }

  if (eventsCancelled > 0 || eventsInserted > 0) {
    revalidatePath('/concessions');
    revalidatePath('/admin/concessions');
  }

  return NextResponse.json({
    ok: true,
    events_inserted: eventsInserted,
    slots_inserted: slotsInserted,
    events_cancelled: eventsCancelled,
    signups_cancelled: signupsCancelled,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
