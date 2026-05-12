import { describe, it, expect } from 'vitest';
import { generateConcessionSlots, type GameBlock } from './generate';

const FRONT = 'field-front';
const ORG = 'org-1';

function block(start: string, end: string, source_uid: string): GameBlock {
  return { id: 'b-' + source_uid, field_id: FRONT, source_uid, start_at: start, end_at: end };
}

describe('generateConcessionSlots', () => {
  it('produces one slot per game starting 30 minutes before the game', () => {
    const games = [block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1')];
    const result = generateConcessionSlots(games, ORG);
    expect(result).toHaveLength(1);
    const ev = result[0];
    expect(ev.event_type).toBe('game');
    expect(ev.slots).toHaveLength(1);
    expect(ev.slots[0].start_at.toISOString()).toBe('2026-05-05T21:30:00.000Z');
    expect(ev.slots[0].end_at.toISOString()).toBe('2026-05-05T23:30:00.000Z');
    expect(ev.slots[0].capacity).toBe(2);
    expect(ev.source_game_ids).toEqual(['g1']);
  });

  it('groups multiple games on the same date into one event with separate slots', () => {
    const games = [
      block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1'),
      block('2026-05-06T00:00:00Z', '2026-05-06T02:00:00Z', 'g2'),
    ];
    const result = generateConcessionSlots(games, ORG);
    expect(result).toHaveLength(1);
    expect(result[0].slots).toHaveLength(2);
    expect(result[0].source_game_ids.sort()).toEqual(['g1', 'g2']);
  });

  it('merges overlapping slots (games starting within 30 min of each other)', () => {
    const games = [
      block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1'),
      block('2026-05-05T22:15:00Z', '2026-05-06T00:15:00Z', 'g2'),
    ];
    const result = generateConcessionSlots(games, ORG);
    expect(result[0].slots).toHaveLength(1);
  });

  it('separates events by date in America/New_York', () => {
    const games = [
      block('2026-05-05T22:00:00Z', '2026-05-06T00:00:00Z', 'g1'),
      block('2026-05-12T22:00:00Z', '2026-05-13T00:00:00Z', 'g2'),
    ];
    const result = generateConcessionSlots(games, ORG);
    expect(result).toHaveLength(2);
    expect(result[0].event_date).toBe('2026-05-05');
    expect(result[1].event_date).toBe('2026-05-12');
  });
});
