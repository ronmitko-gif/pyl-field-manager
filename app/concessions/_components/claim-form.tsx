'use client';

import { useState } from 'react';

export function ClaimForm({
  slotId, onClose, onClaimed,
}: {
  slotId: string;
  onClose: () => void;
  onClaimed: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    const res = await fetch('/api/concessions/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId, name, email }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setStatus('error');
      setError(body.error ?? 'Something went wrong');
      return;
    }
    onClaimed();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Claim this shift</h2>
        <p className="mt-1 text-xs opacity-70">We&apos;ll email a confirmation and a cancel link.</p>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">Name</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-tj-black/20 px-3 py-2"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-tj-black/50">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-tj-black/20 px-3 py-2"
          />
        </label>

        {error && <p className="mt-3 text-xs text-override-red">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={status === 'sending'}
            className="flex-1 rounded bg-tj-black px-3 py-2 text-sm text-tj-cream hover:bg-tj-black/80 disabled:opacity-50"
          >
            {status === 'sending' ? 'Submitting…' : 'Confirm sign-up'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-tj-black/20 px-3 py-2 text-sm hover:bg-tj-cream"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
