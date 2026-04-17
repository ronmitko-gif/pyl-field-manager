import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  const { data: coach } = await supabase
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
    await supabase
      .from('coaches')
      .update({ auth_user_id: user.id })
      .eq('id', coach.id);
  }

  const dest = coach.role === 'admin' ? '/admin' : '/coach';
  return NextResponse.redirect(new URL(dest, url.origin));
}
