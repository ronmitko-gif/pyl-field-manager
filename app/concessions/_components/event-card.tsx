import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

type Event = {
  id: string;
  event_date: string;
  event_type: 'game' | 'tournament';
  location: string;
  filled: number;
  capacity: number;
};

export function EventCard({ event }: { event: Event }) {
  const dateEt = new Date(`${event.event_date}T12:00:00Z`);
  const open = event.capacity - event.filled;
  return (
    <Link
      href={`/concessions/${event.id}`}
      className="block rounded-lg border border-tj-black/10 bg-white p-4 shadow-sm hover:border-tj-gold"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-tj-gold">
            {event.event_type === 'tournament' ? 'Tournament' : 'Game day'}
          </div>
          <h3 className="text-base font-semibold">
            {formatInTimeZone(dateEt, TZ, 'EEEE, MMMM d, yyyy')}
          </h3>
          <p className="text-xs opacity-70">{event.location}</p>
        </div>
        <div className="text-right text-sm">
          {open > 0 ? (
            <span className="font-medium text-tj-gold">{open} open</span>
          ) : (
            <span className="opacity-60">Full</span>
          )}
          <div className="text-xs opacity-60">{event.filled}/{event.capacity} filled</div>
        </div>
      </div>
    </Link>
  );
}
