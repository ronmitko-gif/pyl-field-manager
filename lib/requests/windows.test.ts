import { describe, it, expect } from 'vitest';
import { windowsForDate, fitsInWindow } from './windows';
import type { OpenWindow } from './windows';

const BACK = 'field-back';
const FRONT = 'field-front';

const WINDOWS: OpenWindow[] = [
  { id: 'w1', field_id: BACK, day_of_week: 5, start_time: '20:00:00', end_time: '22:00:00' },
  { id: 'w2', field_id: BACK, day_of_week: 6, start_time: '11:00:00', end_time: '19:00:00' },
  { id: 'w3', field_id: BACK, day_of_week: 0, start_time: '09:00:00', end_time: '19:00:00' },
];

describe('windowsForDate', () => {
  it('returns the Saturday window for a Saturday ET date on Back field', () => {
    const dateEt = new Date('2026-04-25T12:00:00-04:00');
    const result = windowsForDate(WINDOWS, BACK, dateEt);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('w2');
  });

  it('returns [] for a Monday (no window on that dow)', () => {
    const dateEt = new Date('2026-04-20T12:00:00-04:00');
    expect(windowsForDate(WINDOWS, BACK, dateEt)).toEqual([]);
  });

  it('returns [] for a different field on a window dow', () => {
    const dateEt = new Date('2026-04-25T12:00:00-04:00');
    expect(windowsForDate(WINDOWS, FRONT, dateEt)).toEqual([]);
  });
});

describe('fitsInWindow', () => {
  const saturdayWindow = WINDOWS[1];
  it('accepts a range inside the window (ET)', () => {
    const start = new Date('2026-04-25T14:00:00-04:00');
    const end = new Date('2026-04-25T16:00:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(true);
  });

  it('accepts a range exactly matching the window', () => {
    const start = new Date('2026-04-25T11:00:00-04:00');
    const end = new Date('2026-04-25T19:00:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(true);
  });

  it('rejects a range that starts before the window', () => {
    const start = new Date('2026-04-25T10:30:00-04:00');
    const end = new Date('2026-04-25T12:00:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(false);
  });

  it('rejects a range that ends after the window', () => {
    const start = new Date('2026-04-25T18:00:00-04:00');
    const end = new Date('2026-04-25T19:30:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(false);
  });

  it('rejects a range on a different weekday than the window', () => {
    const start = new Date('2026-04-24T14:00:00-04:00');
    const end = new Date('2026-04-24T16:00:00-04:00');
    expect(fitsInWindow(saturdayWindow, start, end)).toBe(false);
  });
});
