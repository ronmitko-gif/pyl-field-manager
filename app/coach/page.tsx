import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function CoachPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  async function signOut() {
    'use server';
    const s = await createClient();
    await s.auth.signOut();
    redirect('/login');
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">Coach portal</h1>
        <p className="text-sm text-neutral-600">
          You&apos;re signed in. The coach view lands in Session 4 — for now, this
          page just confirms auth works for non-admin users.
        </p>
        <form action={signOut}>
          <button className="text-sm underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
