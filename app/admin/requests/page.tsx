import { formatDistanceToNow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveSlotRequest, denySlotRequest } from '../_actions';

const TZ = 'America/New_York';

export default async function RequestsPage() {
  const admin = createAdminClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [pendingRes, recentRes, coachesRes, fieldsRes, teamsRes] = await Promise.all([
    admin
      .from('slot_requests')
      .select('id, requesting_team_id, requester_coach_id, field_id, start_at, end_at, admin_note, status, created_at')
      .eq('status', 'pending')
      .order('created_at'),
    admin
      .from('slot_requests')
      .select('id, requesting_team_id, requester_coach_id, field_id, start_at, end_at, admin_note, status, resolved_at')
      .in('status', ['approved', 'denied'])
      .gte('resolved_at', sevenDaysAgo.toISOString())
      .order('resolved_at', { ascending: false })
      .limit(20),
    admin.from('coaches').select('id, name'),
    admin.from('fields').select('id, name, short_name'),
    admin.from('teams').select('id, name'),
  ]);

  const coachNameById = new Map((coachesRes.data ?? []).map((c) => [c.id, c.name]));
  const fieldNameById = new Map((fieldsRes.data ?? []).map((f) => [f.id, f.short_name ?? f.name]));
  const teamNameById = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]));

  const pending = pendingRes.data ?? [];
  const recent = recentRes.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Slot requests</h2>
        <p className="text-sm opacity-70">
          Pending requests show here. Approving creates a confirmed block and auto-declines any overlaps.
        </p>
      </header>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <h3 className="border-b border-tj-black/10 bg-tj-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">
          Pending ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="p-4 text-sm text-tj-black/50">No pending requests.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
              <tr>
                <th className="p-2">Submitted</th>
                <th className="p-2">Coach</th>
                <th className="p-2">Team</th>
                <th className="p-2">Field</th>
                <th className="p-2">When</th>
                <th className="p-2">Note</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} className="border-t border-tj-black/5 align-top">
                  <td className="p-2 whitespace-nowrap text-xs opacity-70">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                  <td className="p-2">{coachNameById.get(r.requester_coach_id) ?? '—'}</td>
                  <td className="p-2">{teamNameById.get(r.requesting_team_id) ?? '—'}</td>
                  <td className="p-2">{fieldNameById.get(r.field_id) ?? '—'}</td>
                  <td className="p-2 whitespace-nowrap">
                    {formatInTimeZone(new Date(r.start_at), TZ, 'EEE MMM d')}
                    <br />
                    <span className="text-xs opacity-70">
                      {formatInTimeZone(new Date(r.start_at), TZ, 'h:mm a')}–
                      {formatInTimeZone(new Date(r.end_at), TZ, 'h:mm a')}
                    </span>
                  </td>
                  <td className="p-2 text-xs">{r.admin_note ?? '—'}</td>
                  <td className="p-2">
                    <div className="flex justify-end gap-2">
                      <form action={approveSlotRequest}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="rounded bg-tj-gold px-2 py-1 text-xs font-medium text-tj-black hover:bg-tj-gold-soft">
                          Approve
                        </button>
                      </form>
                      <form action={denySlotRequest} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input
                          type="text"
                          name="admin_note"
                          placeholder="Reason (optional)"
                          className="rounded border border-tj-black/20 px-1 py-0.5 text-xs"
                        />
                        <button className="rounded border border-tj-black/20 px-2 py-1 text-xs hover:bg-tj-cream">
                          Deny
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <h3 className="border-b border-tj-black/10 bg-tj-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tj-black/60">
          Recently decided (last 7 days)
        </h3>
        {recent.length === 0 ? (
          <p className="p-4 text-sm text-tj-black/50">No recent decisions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
              <tr>
                <th className="p-2">Resolved</th>
                <th className="p-2">Status</th>
                <th className="p-2">Coach</th>
                <th className="p-2">Field</th>
                <th className="p-2">When</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-tj-black/5">
                  <td className="p-2 text-xs opacity-70">
                    {r.resolved_at ? formatDistanceToNow(new Date(r.resolved_at), { addSuffix: true }) : '—'}
                  </td>
                  <td className="p-2">
                    <span className={r.status === 'approved' ? 'rounded bg-tj-gold px-2 py-0.5 text-xs text-tj-black' : 'rounded bg-tj-black px-2 py-0.5 text-xs text-tj-cream'}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-2">{coachNameById.get(r.requester_coach_id) ?? '—'}</td>
                  <td className="p-2">{fieldNameById.get(r.field_id) ?? '—'}</td>
                  <td className="p-2 whitespace-nowrap text-xs">
                    {formatInTimeZone(new Date(r.start_at), TZ, 'MMM d, h:mm a')}–
                    {formatInTimeZone(new Date(r.end_at), TZ, 'h:mm a')}
                  </td>
                  <td className="p-2 text-xs">{r.admin_note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
