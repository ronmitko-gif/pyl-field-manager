import { describe, it, expect } from 'vitest';
import { materializeSlot } from './materialize';
import type { TravelRecurringSlot } from '@/lib/types';

const ORG_ID = 'org-1';
const slot: TravelRecurringSlot = {
  id: 'slot-1',
  team_id: 'team-1',
  field_id: 'field-1',
  day_of_week: 1,
  start_time: '20:00:00',
  end_time: '22:00:00',
  effective_from: '2026-01-01',
  effective_to: null,
};

describe('materializeSlot', () => {
  it('produces one block per matching weekday in the window', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-05-04T00:00:00Z')
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source_uid).toBe('travel:slot-1:2026-04-20');
    expect(blocks[1].source_uid).toBe('travel:slot-1:2026-04-27');
  });

  it('converts ET wall-clock to UTC (EDT = UTC-4)', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-04-27T00:00:00Z')
    );
    expect(blocks[0].start_at.toISOString()).toBe('2026-04-21T00:00:00.000Z');
    expect(blocks[0].end_at.toISOString()).toBe('2026-04-21T02:00:00.000Z');
  });

  it('handles DST spring-forward', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-03-09T00:00:00Z'),
      new Date('2026-03-16T00:00:00Z')
    );
    expect(blocks[0].start_at.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('handles DST fall-back', () => {
    const blocks = materializeSlot(
      slot,
      ORG_ID,
      new Date('2026-11-02T00:00:00Z'),
      new Date('2026-11-09T00:00:00Z')
    );
    expect(blocks[0].start_at.toISOString()).toBe('2026-11-03T01:00:00.000Z');
  });

  it('respects effective_from', () => {
    const future = { ...slot, effective_from: '2026-05-01' };
    const blocks = materializeSlot(
      future,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-05-11T00:00:00Z')
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source_uid).toBe('travel:slot-1:2026-05-04');
  });

  it('respects effective_to (inclusive)', () => {
    const bounded = { ...slot, effective_to: '2026-04-21' };
    const blocks = materializeSlot(
      bounded,
      ORG_ID,
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-05-11T00:00:00Z')
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source_uid).toBe('travel:slot-1:2026-04-20');
  });
});
