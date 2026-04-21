'use client';

import { useMemo, useState } from 'react';
import { submitSlotRequest } from '../_actions';
import type { OpenWindow } from '@/lib/requests/windows';

type Field = { id: string; name: string };

const DURATIONS_MIN = [60, 90, 120, 150, 180];

function formatHM(totalMin: number) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function timeOptions(window: OpenWindow, durationMin: number): string[] {
  const [ws, wsm] = window.start_time.split(':').slice(0, 2).map(Number);
  const [we, wem] = window.end_time.split(':').slice(0, 2).map(Number);
  const startMin = ws * 60 + wsm;
  const endMin = we * 60 + wem;
  const lastStart = endMin - durationMin;
  if (lastStart < startMin) return [];
  const options: string[] = [];
  for (let m = startMin; m <= lastStart; m += 30) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    options.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
  }
  return options;
}

function displayTime(hms: string): string {
  const [h, m] = hms.split(':').slice(0, 2).map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dowOf(isoDate: string): number {
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 12, 0)).getUTCDay();
}

function datesAhead(weeks: number): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const iso = `${y}-${m}-${day}`;
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    out.push({ iso, label });
  }
  return out;
}

export function RequestForm({
  fields,
  windows,
}: {
  fields: Field[];
  windows: OpenWindow[];
}) {
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [durationMin, setDurationMin] = useState(120);
  const [startTime, setStartTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dates = useMemo(() => {
    return datesAhead(4).filter((d) =>
      windows.some((w) => w.field_id === fieldId && w.day_of_week === dowOf(d.iso))
    );
  }, [fieldId, windows]);

  const activeWindow = useMemo(() => {
    if (!date) return null;
    return (
      windows.find(
        (w) => w.field_id === fieldId && w.day_of_week === dowOf(date)
      ) ?? null
    );
  }, [fieldId, date, windows]);

  const startOptions = useMemo(() => {
    if (!activeWindow) return [];
    return timeOptions(activeWindow, durationMin);
  }, [activeWindow, durationMin]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setSubmitting(true);
    try {
      await submitSlotRequest(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit} className="flex max-w-xl flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Field</span>
        <select
          name="field_id"
          value={fieldId}
          onChange={(e) => {
            setFieldId(e.target.value);
            setDate('');
            setStartTime('');
          }}
          className="rounded border border-tj-black/20 px-2 py-1"
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Date</span>
        <select
          name="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); setStartTime(''); }}
          className="rounded border border-tj-black/20 px-2 py-1"
        >
          <option value="">Pick a date</option>
          {dates.map((d) => (
            <option key={d.iso} value={d.iso}>{d.label}</option>
          ))}
        </select>
        {dates.length === 0 && (
          <span className="text-xs opacity-60">No open windows on this field in the next 4 weeks.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Duration</span>
        <select
          name="duration_minutes"
          value={durationMin}
          onChange={(e) => { setDurationMin(Number(e.target.value)); setStartTime(''); }}
          className="rounded border border-tj-black/20 px-2 py-1"
        >
          {DURATIONS_MIN.map((d) => (
            <option key={d} value={d}>{formatHM(d)}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Start time</span>
        <select
          name="start_time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          disabled={!date || startOptions.length === 0}
          className="rounded border border-tj-black/20 px-2 py-1 disabled:opacity-60"
        >
          <option value="">Pick a start time</option>
          {startOptions.map((t) => (
            <option key={t} value={t}>{displayTime(t)}</option>
          ))}
        </select>
        {date && startOptions.length === 0 && (
          <span className="text-xs opacity-60">No start times fit that duration in this window.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-tj-black/50">Note (optional)</span>
        <textarea name="note" rows={2} maxLength={300} className="rounded border border-tj-black/20 px-2 py-1" />
      </label>

      <div>
        <button
          type="submit"
          disabled={!fieldId || !date || !startTime || submitting}
          className="rounded bg-tj-gold px-3 py-1.5 font-medium text-tj-black hover:bg-tj-gold-soft disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Request slot'}
        </button>
      </div>

      {error && <p className="text-sm text-override-red">{error}</p>}
    </form>
  );
}
