'use client';

import { useState } from 'react';
import { createTournamentEvent } from '../_actions';

export function NewTournamentForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await createTournamentEvent(formData);
      if (!result.ok) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-3 rounded border border-tj-black/10 bg-white p-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Name (optional)</span>
        <input type="text" name="name" maxLength={120} placeholder="e.g. Memorial Day Classic" className="w-52 rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Date</span>
        <input type="date" name="event_date" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Start time</span>
        <input type="time" name="start_time" step={1800} defaultValue="11:30" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">End time</span>
        <input type="time" name="end_time" step={1800} defaultValue="22:00" required className="rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Slot length</span>
        <select name="slot_minutes" defaultValue="30" className="rounded border border-tj-black/20 px-2 py-1">
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">60 min</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Capacity/slot</span>
        <input type="number" name="capacity" min={1} max={20} defaultValue={2} required className="w-20 rounded border border-tj-black/20 px-2 py-1" />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-tj-gold px-3 py-1.5 text-sm font-medium text-tj-black hover:bg-tj-gold-soft disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Create tournament'}
      </button>
      {error && <span className="basis-full text-xs text-override-red">{error}</span>}
    </form>
  );
}
