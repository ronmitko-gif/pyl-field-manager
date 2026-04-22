'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMessage('');
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-tj-cream text-tj-black">
      <header className="flex items-center justify-between border-b border-tj-black/10 bg-tj-black px-6 py-3 text-tj-cream">
        <h1 className="text-lg font-semibold">
          <span className="text-tj-gold">PYL</span> Field Manager — TJYBB
        </h1>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5 rounded-lg border border-tj-black/10 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">Sign in</h2>
            <p className="mt-1 text-sm opacity-70">
              Enter your coach email — we&apos;ll send you a magic link.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-sm">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded border border-tj-black/20 px-3 py-2"
              disabled={status === 'sending' || status === 'sent'}
            />
            <button
              type="submit"
              disabled={status === 'sending' || status === 'sent'}
              className="w-full rounded bg-tj-black px-3 py-2 text-tj-cream hover:bg-tj-black/80 disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Check your email' : 'Send magic link'}
            </button>
            {status === 'sent' && (
              <p className="text-xs text-tj-gold">Check your email for the sign-in link.</p>
            )}
            {status === 'error' && (
              <p className="text-xs text-override-red">{errorMessage}</p>
            )}
          </form>

          <div className="border-t border-tj-black/10 pt-4 text-center">
            <Link href="/schedule" className="text-sm underline underline-offset-4 hover:text-tj-gold">
              View public schedule →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
