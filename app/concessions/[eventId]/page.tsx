import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { SlotRow } from '../_components/slot-row';

export const revalidate = 30;
const TZ = 'America/New_York';

export default async function ConcessionEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) notFound();

  const { data: slots } = await admin
    .from('concession_slots')
    .select('id, start_at, end_at, capacity')
    .eq('event_id', event.id)
    .order('start_at');

  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: signups } = slotIds.length
    ? await admin
        .from('concession_signups')
        .select('id, slot_id, volunteer_name')
        .is('cancelled_at', null)
        .in('slot_id', slotIds)
    : { data: [] };

  const signupsBySlot = new Map<string, { id: string; name: string }[]>();
  for (const su of signups ?? []) {
    const list = signupsBySlot.get(su.slot_id) ?? [];
    list.push({ id: su.id, name: su.volunteer_name });
    signupsBySlot.set(su.slot_id, list);
  }

  const dateEt = new Date(`${event.event_date}T12:00:00Z`);

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <Link href="/concessions" className="text-xs text-tj-gold-soft hover:text-tj-gold">← All events</Link>
        <h1 className="mt-1 text-lg font-semibold">
          {formatInTimeZone(dateEt, TZ, 'EEEE, MMMM d, yyyy')}
        </h1>
        <p className="text-xs opacity-70">{event.location}</p>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
        {(slots ?? []).length === 0 ? (
          <p className="rounded border border-tj-black/10 bg-white p-6 text-sm">No shifts yet.</p>
        ) : (
          (slots ?? []).map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              signups={signupsBySlot.get(slot.id) ?? []}
            />
          ))
        )}
      </main>
    </div>
  );
}
