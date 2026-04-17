import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseIcal } from './parser';

const fixture = readFileSync(
  path.join(__dirname, 'fixtures/sample.ics'),
  'utf8'
);

describe('parseIcal', () => {
  it('extracts UID, start/end, summary, and description for each VEVENT', () => {
    const events = parseIcal(fixture);
    expect(events).toHaveLength(2);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test');
    expect(first).toBeDefined();
    expect(first!.summary).toBe('Pirates @ Orioles');
    expect(first!.description).toBe(
      'Andrew Reilly Memorial Park > 885 Back Field'
    );
  });

  it('splits description into park and field name on " > "', () => {
    const events = parseIcal(fixture);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test')!;
    expect(first.park).toBe('Andrew Reilly Memorial Park');
    expect(first.field_name).toBe('885 Back Field');
  });

  it('splits summary on " @ " into away / home team names', () => {
    const events = parseIcal(fixture);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test')!;
    expect(first.away_team_raw).toBe('Pirates');
    expect(first.home_team_raw).toBe('Orioles');
  });

  it('preserves UTC dates (no TZ re-application)', () => {
    const events = parseIcal(fixture);
    const first = events.find((e) => e.uid === 'game-12345@sportsconnect.test')!;
    expect(first.start_at.toISOString()).toBe('2026-04-20T23:00:00.000Z');
    expect(first.end_at.toISOString()).toBe('2026-04-21T00:30:00.000Z');
  });
});
