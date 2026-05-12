import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { confirmationEmail } from '@/lib/email/concession-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 200) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return null;
  return trimmed;
}

export async function POST(req: Request) {
  let body: { slotId?: string; name?: string; email?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }); }

  const slotId = typeof body.slotId === 'string' ? body.slotId : null;
  const name = normalizeName(body.name);
  const email = normalizeEmail(body.email);

  if (!slotId) return NextResponse.json({ ok: false, error: 'Missing slot' }, { status: 400 });
  if (!name)   return NextResponse.json({ ok: false, error: 'Name must be 2–60 characters' }, { status: 400 });
  if (!email)  return NextResponse.json({ ok: false, error: 'Please use a valid email' }, { status: 400 });

  const admin = createAdminClient();

  const { data: slot } = await admin
    .from('concession_slots')
    .select('id, start_at, end_at, event_id')
    .eq('id', slotId)
    .maybeSingle();
  if (!slot) return NextResponse.json({ ok: false, error: 'Slot not found' }, { status: 404 });

  const { data: event } = await admin
    .from('concession_events')
    .select('location')
    .eq('id', slot.event_id)
    .maybeSingle();

  const { data: row, error } = await admin
    .from('concession_signups')
    .insert({
      slot_id: slotId,
      volunteer_name: name,
      volunteer_email: email,
      confirmed_at: new Date().toISOString(),
    })
    .select('cancel_token')
    .single();
  if (error) {
    if (error.message?.includes('Slot is full')) {
      return NextResponse.json({ ok: false, error: 'That slot just filled up. Pick another.' }, { status: 409 });
    }
    if (error.code === '23505') {
      return NextResponse.json({ ok: false, error: 'You already signed up for this slot.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: `Couldn't save: ${error.message}` }, { status: 500 });
  }

  const tmpl = confirmationEmail({
    name,
    start_at: slot.start_at,
    end_at: slot.end_at,
    location: event?.location ?? 'Andrew Reilly Memorial Park',
    cancelToken: row.cancel_token,
  });
  await sendEmail({ to: email, subject: tmpl.subject, html: tmpl.html });

  return NextResponse.json({ ok: true });
}
