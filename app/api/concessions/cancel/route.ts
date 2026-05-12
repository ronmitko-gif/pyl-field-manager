import 'server-only';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { cancellationEmail } from '@/lib/email/concession-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const url = new URL(req.url);
  let token = url.searchParams.get('token');
  if (!token) {
    const body = await req.json().catch(() => ({}));
    token = typeof body.token === 'string' ? body.token : null;
  }
  if (typeof token !== 'string' || token.length < 8) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: signup } = await admin
    .from('concession_signups')
    .select('id, volunteer_name, volunteer_email, cancelled_at, slot_id')
    .eq('cancel_token', token)
    .maybeSingle();
  if (!signup) return NextResponse.json({ ok: false, error: 'Signup not found' }, { status: 404 });
  if (signup.cancelled_at) return NextResponse.json({ ok: true, alreadyCancelled: true });

  const { data: slot } = await admin
    .from('concession_slots')
    .select('start_at, end_at, event_id')
    .eq('id', signup.slot_id)
    .maybeSingle();
  const { data: event } = slot
    ? await admin.from('concession_events').select('location').eq('id', slot.event_id).maybeSingle()
    : { data: null };

  await admin
    .from('concession_signups')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', signup.id);

  if (slot) {
    const tmpl = cancellationEmail({
      name: signup.volunteer_name,
      start_at: slot.start_at,
      end_at: slot.end_at,
      location: event?.location ?? 'Andrew Reilly Memorial Park',
    });
    await sendEmail({ to: signup.volunteer_email, subject: tmpl.subject, html: tmpl.html });
    revalidatePath('/concessions');
    revalidatePath(`/concessions/${slot.event_id}`);
    revalidatePath('/admin/concessions');
    revalidatePath(`/admin/concessions/${slot.event_id}`);
  }

  return NextResponse.json({ ok: true });
}
