import 'server-only';
import { NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { signupsToCsv } from '@/lib/concessions/csv';

const TZ = 'America/New_York';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  const { data: me } = await admin
    .from('coaches').select('role').eq('auth_user_id', user.id).maybeSingle();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { eventId } = await params;
  const { data: event } = await admin
    .from('concession_events').select('id, event_date').eq('id', eventId).maybeSingle();
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: slots } = await admin
    .from('concession_slots').select('id, start_at, end_at').eq('event_id', eventId).order('start_at');
  const { data: signups } = await admin
    .from('concession_signups')
    .select('slot_id, volunteer_name, volunteer_email')
    .is('cancelled_at', null)
    .in('slot_id', (slots ?? []).map((s) => s.id));

  const slotById = new Map((slots ?? []).map((s) => [s.id, s]));
  const rows = (signups ?? [])
    .map((su) => {
      const slot = slotById.get(su.slot_id);
      if (!slot) return null;
      const time = `${formatInTimeZone(new Date(slot.start_at), TZ, 'h:mm a')} – ${formatInTimeZone(new Date(slot.end_at), TZ, 'h:mm a')}`;
      return { time, name: su.volunteer_name, email: su.volunteer_email };
    })
    .filter((r): r is { time: string; name: string; email: string } => r !== null)
    .sort((a, b) => a.time.localeCompare(b.time));

  const csv = signupsToCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="concessions-${event.event_date}.csv"`,
    },
  });
}
