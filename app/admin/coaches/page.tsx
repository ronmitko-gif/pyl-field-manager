import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function CoachesPage() {
  const admin = createAdminClient();
  const [coachesRes, teamsRes] = await Promise.all([
    admin
      .from('coaches')
      .select('id, name, email, role, team_id, phone')
      .order('role', { ascending: false })
      .order('name'),
    admin.from('teams').select('id, name'),
  ]);
  const coaches = coachesRes.data ?? [];
  const teamNameById = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Coaches</h2>
          <p className="text-sm opacity-70">
            Add or edit coach accounts. New coaches log in via magic link with the email below.
          </p>
        </div>
        <Link href="/admin/coaches/new" className="rounded bg-tj-gold px-3 py-1.5 text-sm font-medium text-tj-black hover:bg-tj-gold-soft">
          Add coach
        </Link>
      </header>

      <section className="overflow-hidden rounded-lg border border-tj-black/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-tj-cream text-left text-xs uppercase text-tj-black/50">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Email</th>
              <th className="p-2">Role</th>
              <th className="p-2">Team</th>
              <th className="p-2">Phone</th>
              <th className="p-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {coaches.map((c) => (
              <tr key={c.id} className="border-t border-tj-black/5">
                <td className="p-2 font-medium">{c.name}</td>
                <td className="p-2 opacity-80">{c.email}</td>
                <td className="p-2">
                  <span className={c.role === 'admin' ? 'rounded bg-tj-black px-2 py-0.5 text-xs text-tj-cream' : 'rounded bg-tj-cream px-2 py-0.5 text-xs'}>
                    {c.role}
                  </span>
                </td>
                <td className="p-2">{c.team_id ? teamNameById.get(c.team_id) ?? '—' : '—'}</td>
                <td className="p-2">{c.phone ?? '—'}</td>
                <td className="p-2 text-right">
                  <Link href={`/admin/coaches/${c.id}`} className="text-xs underline hover:no-underline">Edit</Link>
                </td>
              </tr>
            ))}
            {coaches.length === 0 && (
              <tr><td colSpan={6} className="p-3 text-tj-black/50">No coaches yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
