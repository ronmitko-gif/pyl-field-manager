import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { EventCard } from './_components/event-card';

export const revalidate = 60;

export default async function ConcessionsPage() {
  const admin = createAdminClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const { data: events } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location')
    .gte('event_date', today.toISOString().slice(0, 10))
    .order('event_date');

  const eventIds = (events ?? []).map((e) => e.id);
  const { data: slots } = eventIds.length
    ? await admin
        .from('concession_slots')
        .select('id, event_id, capacity')
        .in('event_id', eventIds)
    : { data: [] };
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: signups } = slotIds.length
    ? await admin
        .from('concession_signups')
        .select('slot_id')
        .is('cancelled_at', null)
        .in('slot_id', slotIds)
    : { data: [] };

  const slotsByEvent = new Map<string, { capacity: number; ids: string[] }>();
  for (const s of slots ?? []) {
    const entry = slotsByEvent.get(s.event_id) ?? { capacity: 0, ids: [] };
    entry.capacity += s.capacity;
    entry.ids.push(s.id);
    slotsByEvent.set(s.event_id, entry);
  }
  const filledBySlot = new Map<string, number>();
  for (const su of signups ?? []) {
    filledBySlot.set(su.slot_id, (filledBySlot.get(su.slot_id) ?? 0) + 1);
  }

  const enriched = (events ?? []).map((e) => {
    const info = slotsByEvent.get(e.id);
    const filled = (info?.ids ?? []).reduce((acc, id) => acc + (filledBySlot.get(id) ?? 0), 0);
    return { ...e, capacity: info?.capacity ?? 0, filled };
  });

  return (
    <div className="min-h-screen bg-tj-cream text-tj-black">
      <header className="border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <div className="text-xs uppercase tracking-wide text-tj-gold">TJYBB</div>
        <h1 className="text-lg font-semibold">Concession Stand Volunteers</h1>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <p className="text-sm opacity-80">
          Sign up for an hour or two — every shift helps the league.
        </p>
        {enriched.length === 0 ? (
          <p className="rounded border border-tj-black/10 bg-white p-6 text-sm text-tj-black/60">
            No upcoming events yet. Check back soon.
          </p>
        ) : (
          enriched.map((e) => <EventCard key={e.id} event={e} />)
        )}
        <p className="mt-4 text-xs opacity-60">
          <Link href="/login" className="underline hover:no-underline">Admin/coach sign-in</Link>
        </p>
      </main>
    </div>
  );
}
