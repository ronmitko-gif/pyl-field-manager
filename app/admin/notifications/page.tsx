import { formatInTimeZone } from 'date-fns-tz';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';

export const revalidate = 60;

const TZ = 'America/New_York';

type Filter = 'all' | 'email' | 'sms' | 'failed';

function parseFilter(raw: string | undefined): Filter {
  if (raw === 'email' || raw === 'sms' || raw === 'failed') return raw;
  return 'all';
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = parseFilter(params.filter);

  const admin = createAdminClient();
  let query = admin
    .from('notifications')
    .select('id, created_at, sent_at, channel, coach_id, body, status, error_message, external_id')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filter === 'email') query = query.eq('channel', 'email');
  if (filter === 'sms') query = query.eq('channel', 'sms');
  if (filter === 'failed') query = query.eq('status', 'failed');

  const [notesRes, coachesRes] = await Promise.all([
    query,
    admin.from('coaches').select('id, name'),
  ]);
  const notes = notesRes.data ?? [];
  const coachNameById = new Map((coachesRes.data ?? []).map((c) => [c.id, c.name]));

  const chip = (label: string, value: Filter) => {
    const active = filter === value;
    return (
      <Link
        key={value}
        href={value === 'all' ? '/admin/notifications' : `/admin/notifications?filter=${value}`}
        className={
          active
            ? 'rounded-full bg-tj-black px-3 py-1 text-xs text-tj-cream'
            : 'rounded-full border border-tj-black/20 px-3 py-1 text-xs hover:bg-tj-cream'
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Notifications log</h2>
        <p className="text-sm opacity-70">Last 100 outbound messages (auto-refreshes every 60s).</p>
      </header>

      <div className="flex gap-2">
        {chip('All', 'all')}
        {chip('Email', 'email')}
        {chip('SMS', 'sms')}
        {chip('Failed', 'failed')}
      </div>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">Channel</th>
              <th className="p-2">Coach</th>
              <th className="p-2">Preview</th>
              <th className="p-2">Status</th>
              <th className="p-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id} className="border-t border-tj-black/5 align-top">
                <td
                  className="p-2 whitespace-nowrap text-xs"
                  title={formatInTimeZone(new Date(n.created_at), TZ, 'yyyy-MM-dd HH:mm:ss')}
                >
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </td>
                <td className="p-2">{n.channel === 'email' ? '📧 email' : '📱 sms'}</td>
                <td className="p-2">{coachNameById.get(n.coach_id) ?? '—'}</td>
                <td className="p-2 max-w-sm text-xs">
                  {n.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}
                  {n.body.length > 80 ? '…' : ''}
                </td>
                <td className="p-2">
                  <span
                    className={
                      n.status === 'sent'
                        ? 'rounded bg-tj-gold px-2 py-0.5 text-xs text-tj-black'
                        : n.status === 'failed'
                        ? 'rounded bg-override-red px-2 py-0.5 text-xs text-white'
                        : n.status === 'skipped'
                        ? 'rounded border border-tj-black/20 px-2 py-0.5 text-xs'
                        : 'rounded bg-tj-black/70 px-2 py-0.5 text-xs text-tj-cream'
                    }
                  >
                    {n.status}
                  </span>
                </td>
                <td className="p-2 max-w-xs text-xs opacity-70">{n.error_message ?? '—'}</td>
              </tr>
            ))}
            {notes.length === 0 && (
              <tr><td colSpan={6} className="p-3 text-tj-black/50">No notifications yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
