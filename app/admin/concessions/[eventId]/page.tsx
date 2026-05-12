import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { removeSignup } from '../_actions';

const TZ = 'America/New_York';

export default async function AdminConcessionEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location, source_game_ids')
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
        .select('id, slot_id, volunteer_name, volunteer_email, created_at')
        .is('cancelled_at', null)
        .in('slot_id', slotIds)
    : { data: [] };

  const signupsBySlot = new Map<string, { id: string; slot_id: string; volunteer_name: string; volunteer_email: string }[]>();
  for (const su of signups ?? []) {
    if (!su.slot_id) continue;
    const list = signupsBySlot.get(su.slot_id) ?? [];
    list.push(su);
    signupsBySlot.set(su.slot_id, list);
  }

  const dateEt = new Date(`${event.event_date}T12:00:00Z`);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <Link href="/admin/concessions" className="text-xs underline">← All events</Link>
          <h2 className="mt-1 text-lg font-semibold">
            {formatInTimeZone(dateEt, TZ, 'EEEE, MMM d, yyyy')}
          </h2>
          <p className="text-xs opacity-70">{event.location} · {event.event_type}</p>
        </div>
        <Link
          href={`/api/concessions/export/${event.id}`}
          className="rounded border border-tj-black/20 px-3 py-1.5 text-sm hover:bg-tj-cream"
        >
          Export CSV
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        {(slots ?? []).map((slot) => {
          const list = signupsBySlot.get(slot.id) ?? [];
          return (
            <article key={slot.id} className="rounded border border-tj-black/10 bg-white p-4 text-sm">
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">
                  {formatInTimeZone(new Date(slot.start_at), TZ, 'h:mm a')} – {formatInTimeZone(new Date(slot.end_at), TZ, 'h:mm a')}
                </h3>
                <span className="text-xs opacity-60">{list.length}/{slot.capacity}</span>
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {list.map((su) => (
                  <li key={su.id} className="flex items-center justify-between gap-3 rounded bg-tj-cream px-2 py-1">
                    <span>
                      <span className="font-medium">{su.volunteer_name}</span>
                      <span className="ml-2 text-xs opacity-70">{su.volunteer_email}</span>
                    </span>
                    <form action={removeSignup}>
                      <input type="hidden" name="id" value={su.id} />
                      <button className="text-xs underline opacity-70 hover:opacity-100">Remove</button>
                    </form>
                  </li>
                ))}
                {list.length === 0 && (
                  <li className="text-xs opacity-60">No signups yet.</li>
                )}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}
