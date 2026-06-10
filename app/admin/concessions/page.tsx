import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { NewTournamentForm } from './_components/new-tournament-form';

const TZ = 'America/New_York';

export default async function AdminConcessionsPage() {
  const admin = createAdminClient();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const { data: events } = await admin
    .from('concession_events')
    .select('id, event_date, event_type, location, name')
    .gte('event_date', today.toISOString().slice(0, 10))
    .order('event_date');

  const eventIds = (events ?? []).map((e) => e.id);
  const { data: slots } = eventIds.length
    ? await admin.from('concession_slots').select('id, event_id, capacity').in('event_id', eventIds)
    : { data: [] };
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: signups } = slotIds.length
    ? await admin
        .from('concession_signups')
        .select('slot_id')
        .is('cancelled_at', null)
        .in('slot_id', slotIds)
    : { data: [] };

  const totalCapacityByEvent = new Map<string, number>();
  const slotsByEvent = new Map<string, string[]>();
  for (const s of slots ?? []) {
    totalCapacityByEvent.set(s.event_id, (totalCapacityByEvent.get(s.event_id) ?? 0) + s.capacity);
    const ids = slotsByEvent.get(s.event_id) ?? [];
    ids.push(s.id);
    slotsByEvent.set(s.event_id, ids);
  }
  const filledBySlot = new Map<string, number>();
  for (const su of signups ?? []) filledBySlot.set(su.slot_id, (filledBySlot.get(su.slot_id) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Concession events</h2>
        <p className="text-sm opacity-70">
          Game days are auto-created from front-field rec games. Manual entry below for tournaments.
        </p>
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">New tournament</h3>
        <NewTournamentForm />
      </section>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <h3 className="border-b border-tj-black/10 bg-tj-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">
          Upcoming events
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
              <tr><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Filled</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {(events ?? []).map((e) => {
                const cap = totalCapacityByEvent.get(e.id) ?? 0;
                const ids = slotsByEvent.get(e.id) ?? [];
                const filled = ids.reduce((acc, id) => acc + (filledBySlot.get(id) ?? 0), 0);
                const dateEt = new Date(`${e.event_date}T12:00:00Z`);
                return (
                  <tr key={e.id} className="border-t border-tj-black/5">
                    <td className="p-2 whitespace-nowrap">
                      {e.name && <div className="font-medium">{e.name}</div>}
                      <div className={e.name ? 'text-xs text-tj-black/50' : undefined}>
                        {formatInTimeZone(dateEt, TZ, 'EEE MMM d, yyyy')}
                      </div>
                    </td>
                    <td className="p-2 capitalize">{e.event_type}</td>
                    <td className="p-2">{filled}/{cap}</td>
                    <td className="p-2 text-right">
                      <Link href={`/admin/concessions/${e.id}`} className="text-xs underline">Manage →</Link>
                    </td>
                  </tr>
                );
              })}
              {(events ?? []).length === 0 && (
                <tr><td colSpan={4} className="p-3 text-tj-black/50">No upcoming events.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
