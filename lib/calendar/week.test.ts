import { describe, it, expect } from 'vitest';
import {
  currentWeek,
  parseWeekParam,
  nextWeek,
  prevWeek,
  formatWeekParam,
  weekLabel,
} from './week';

describe('parseWeekParam', () => {
  it('parses "2026-W17" to the ET Monday Apr 20', () => {
    const w = parseWeekParam('2026-W17');
    expect(w.start.toISOString()).toBe('2026-04-20T04:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2026-04-27T04:00:00.000Z');
    expect(w.param).toBe('2026-W17');
  });

  it('falls back to current week on missing/malformed', () => {
    const current = currentWeek();
    expect(parseWeekParam(undefined).param).toBe(current.param);
    expect(parseWeekParam('bananas').param).toBe(current.param);
  });
});

describe('nextWeek / prevWeek', () => {
  it('increments and decrements by 7 days', () => {
    const w = parseWeekParam('2026-W17');
    expect(nextWeek(w).param).toBe('2026-W18');
    expect(prevWeek(w).param).toBe('2026-W16');
  });
});

describe('weekLabel', () => {
  it('returns "Apr 20 – Apr 26, 2026"', () => {
    expect(weekLabel(parseWeekParam('2026-W17'))).toBe('Apr 20 – Apr 26, 2026');
  });
});

describe('formatWeekParam', () => {
  it('round-trips', () => {
    const w = parseWeekParam('2026-W17');
    expect(formatWeekParam(w.start)).toBe('2026-W17');
  });
});
