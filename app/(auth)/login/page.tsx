'use client';

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
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">PYL Field Manager</h1>
        <p className="text-sm text-neutral-600">Sign in to continue.</p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full border rounded px-3 py-2"
          disabled={status === 'sending' || status === 'sent'}
        />
        <button
          type="submit"
          disabled={status === 'sending' || status === 'sent'}
          className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
        </button>
        {status === 'sent' && (
          <p className="text-sm text-green-700">
            Check your email for the sign-in link.
          </p>
        )}
        {status === 'error' && (
          <p className="text-sm text-red-700">{errorMessage}</p>
        )}
      </form>
    </main>
  );
}
