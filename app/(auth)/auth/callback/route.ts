import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = await createClient();
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(exchangeErr.message)}`, url.origin)
    );
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user?.email) {
    return NextResponse.redirect(new URL('/login?error=no_user', url.origin));
  }

  // Use the admin client for the coach lookup + first-login link-up.
  // RLS policy "coaches see self" (auth_user_id = auth.uid()) blocks the user's
  // own row before auth_user_id is populated, which would incorrectly report
  // the user as not registered. This step is an admin-style operation.
  const admin = createAdminClient();
  const { data: coach } = await admin
    .from('coaches')
    .select('id, role, auth_user_id')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();

  if (!coach) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL('/login?error=not_registered', url.origin)
    );
  }

  if (!coach.auth_user_id) {
    await admin
      .from('coaches')
      .update({ auth_user_id: user.id })
      .eq('id', coach.id);
  }

  const dest = coach.role === 'admin' ? '/admin' : '/coach';
  return NextResponse.redirect(new URL(dest, url.origin));
}
