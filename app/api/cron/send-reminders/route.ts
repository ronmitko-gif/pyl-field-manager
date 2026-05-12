import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { reminderEmail } from '@/lib/email/concession-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const now = new Date();
  const startOfDayUtc = new Date(now);
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const endOfDayUtc = new Date(startOfDayUtc);
  endOfDayUtc.setUTCDate(endOfDayUtc.getUTCDate() + 1);

  const { data: slots } = await admin
    .from('concession_slots')
    .select('id, start_at, end_at, event_id')
    .gte('start_at', startOfDayUtc.toISOString())
    .lt('start_at', endOfDayUtc.toISOString());

  if (!slots || slots.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, slots: 0 });
  }

  const slotIds = slots.map((s) => s.id);
  const { data: signups } = await admin
    .from('concession_signups')
    .select('id, slot_id, volunteer_name, volunteer_email, cancel_token, reminder_sent_at')
    .in('slot_id', slotIds)
    .is('cancelled_at', null);

  const eventIds = [...new Set(slots.map((s) => s.event_id))];
  const { data: events } = await admin
    .from('concession_events').select('id, location').in('id', eventIds);
  const locById = new Map((events ?? []).map((e) => [e.id, e.location]));
  const slotById = new Map(slots.map((s) => [s.id, s]));

  let sent = 0;
  for (const su of signups ?? []) {
    if (su.reminder_sent_at) continue;
    const slot = slotById.get(su.slot_id);
    if (!slot) continue;

    const tmpl = reminderEmail({
      name: su.volunteer_name,
      start_at: slot.start_at,
      end_at: slot.end_at,
      location: locById.get(slot.event_id) ?? 'Andrew Reilly Memorial Park',
      cancelToken: su.cancel_token,
    });
    const result = await sendEmail({ to: su.volunteer_email, subject: tmpl.subject, html: tmpl.html });
    if (result.ok) {
      await admin
        .from('concession_signups')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', su.id);
      sent += 1;
    }
  }

  return NextResponse.json({ ok: true, sent, slots: slots.length });
}

export async function GET(req: Request) {
  return POST(req);
}
