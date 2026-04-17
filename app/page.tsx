import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: coach } = await supabase
    .from('coaches')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  redirect(coach?.role === 'admin' ? '/admin' : '/coach');
}
