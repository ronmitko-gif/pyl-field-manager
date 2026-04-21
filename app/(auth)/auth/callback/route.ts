import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type VerifyOtpType =
  | 'magiclink'
  | 'email'
  | 'signup'
  | 'invite'
  | 'recovery'
  | 'email_change';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as VerifyOtpType | null;

  if (!code && !token_hash) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = await createClient();
  let exchangeErr: Error | null = null;

  if (token_hash && type) {
    // Token-hash flow — self-contained, no PKCE cookie required.
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (error) exchangeErr = new Error(error.message);
  } else if (code) {
    // Legacy PKCE flow — kept for email templates that haven't been updated yet.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) exchangeErr = new Error(error.message);
  }

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
