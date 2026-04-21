import Link from 'next/link';
import { createCoach, updateCoach } from '../_actions';

type Team = { id: string; name: string };
type Coach = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'coach';
  team_id: string | null;
  phone: string | null;
  auth_user_id: string | null;
};

export function CoachForm({
  mode,
  teams,
  coach,
}: {
  mode: 'create' | 'edit';
  teams: Team[];
  coach?: Coach;
}) {
  const action = mode === 'create' ? createCoach : updateCoach;
  const emailLocked = mode === 'edit' && coach?.auth_user_id !== null;

  return (
    <form action={action} className="flex max-w-xl flex-col gap-4 text-sm">
      {mode === 'edit' && coach && <input type="hidden" name="id" value={coach.id} />}

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Name</span>
        <input type="text" name="name" required defaultValue={coach?.name ?? ''} className="rounded border border-tj-black/20 px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Email</span>
        <input type="email" name="email" required defaultValue={coach?.email ?? ''} disabled={emailLocked} className="rounded border border-tj-black/20 px-2 py-1 disabled:bg-tj-cream disabled:opacity-60" />
        {emailLocked && (
          <span className="text-xs opacity-60">Locked because this coach has already logged in.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Role</span>
        <select name="role" defaultValue={coach?.role ?? 'coach'} className="rounded border border-tj-black/20 px-2 py-1">
          <option value="coach">Coach</option>
          <option value="admin">Admin</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Team</span>
        <select name="team_id" defaultValue={coach?.team_id ?? ''} className="rounded border border-tj-black/20 px-2 py-1">
          <option value="">None (admins and unassigned)</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Phone</span>
        <input type="tel" name="phone" defaultValue={coach?.phone ?? ''} placeholder="+14125550123" className="rounded border border-tj-black/20 px-2 py-1" />
      </label>

      <div className="flex gap-2">
        <button type="submit" className="rounded bg-tj-black px-3 py-1.5 text-tj-cream hover:bg-tj-black/80">
          {mode === 'create' ? 'Add coach' : 'Save changes'}
        </button>
        <Link href="/admin/coaches" className="rounded border border-tj-black/20 px-3 py-1.5 hover:bg-tj-cream">Cancel</Link>
      </div>
    </form>
  );
}
