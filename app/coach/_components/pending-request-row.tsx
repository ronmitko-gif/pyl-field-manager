import { formatInTimeZone } from 'date-fns-tz';
import { withdrawSlotRequest } from '../_actions';

const TZ = 'America/New_York';

type Request = {
  id: string;
  start_at: string;
  end_at: string;
  field_id: string;
  admin_note: string | null;
};

export function PendingRequestRow({
  request,
  fieldName,
}: {
  request: Request;
  fieldName: string;
}) {
  const start = new Date(request.start_at);
  const end = new Date(request.end_at);
  return (
    <li className="flex items-center justify-between rounded border border-tj-black/10 bg-white p-3 text-sm">
      <div>
        <div className="font-medium">
          {formatInTimeZone(start, TZ, 'EEE MMM d')} · {formatInTimeZone(start, TZ, 'h:mm a')}–{formatInTimeZone(end, TZ, 'h:mm a')}
        </div>
        <div className="text-xs opacity-70">{fieldName} · awaiting admin approval</div>
        {request.admin_note && <div className="mt-1 text-xs opacity-70">Your note: {request.admin_note}</div>}
      </div>
      <form action={withdrawSlotRequest}>
        <input type="hidden" name="id" value={request.id} />
        <button className="text-xs underline hover:no-underline">Withdraw</button>
      </form>
    </li>
  );
}
