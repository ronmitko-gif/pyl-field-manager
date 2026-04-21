'use client';

import { useState } from 'react';
import { overrideTravelBlock } from '../_actions';

export function OverrideForm({ blockId }: { blockId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    if (!confirm('This will notify the travel coach via email and SMS. Continue?')) return;
    setError(null);
    setSubmitting(true);
    try {
      await overrideTravelBlock(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-override-red px-3 py-1.5 text-sm text-override-red hover:bg-override-red hover:text-white"
      >
        Override for rec makeup
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 rounded border border-override-red bg-override-red/5 p-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-override-red">
        Override for rec makeup
      </div>
      <input type="hidden" name="block_id" value={blockId} />
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Away team</span>
        <input type="text" name="away_team_raw" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Home team</span>
        <input type="text" name="home_team_raw" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Reason (optional)</span>
        <textarea name="reason" rows={2} maxLength={300} className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-override-red px-3 py-1.5 text-sm font-medium text-white hover:bg-override-red/90 disabled:opacity-50"
        >
          {submitting ? 'Overriding…' : 'Override & notify coach'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-tj-black/20 px-3 py-1.5 text-sm hover:bg-tj-cream"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-override-red">{error}</p>}
    </form>
  );
}
