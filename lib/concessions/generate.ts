import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

export type GameBlock = {
  id: string;
  field_id: string;
  source_uid: string;
  start_at: string;
  end_at: string;
};

export type GeneratedSlot = {
  start_at: Date;
  end_at: Date;
  capacity: number;
};

export type GeneratedEvent = {
  org_id: string;
  event_date: string;
  event_type: 'game';
  source_game_ids: string[];
  slots: GeneratedSlot[];
};

const HALF_HOUR_MS = 30 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function generateConcessionSlots(
  games: GameBlock[],
  orgId: string
): GeneratedEvent[] {
  const byDate = new Map<string, GameBlock[]>();
  for (const g of games) {
    const date = formatInTimeZone(new Date(g.start_at), TZ, 'yyyy-MM-dd');
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(g);
  }

  const events: GeneratedEvent[] = [];
  for (const [date, dateGames] of [...byDate.entries()].sort()) {
    const provisional: { slot: GeneratedSlot; uids: string[] }[] = dateGames
      .map((g) => {
        const gameStart = new Date(g.start_at).getTime();
        return {
          slot: {
            start_at: new Date(gameStart - HALF_HOUR_MS),
            end_at: new Date(gameStart - HALF_HOUR_MS + TWO_HOURS_MS),
            capacity: 2,
          },
          uids: [g.source_uid],
        };
      })
      .sort((a, b) => a.slot.start_at.getTime() - b.slot.start_at.getTime());

    const merged: { slot: GeneratedSlot; uids: string[] }[] = [];
    for (const p of provisional) {
      const last = merged[merged.length - 1];
      if (last && p.slot.start_at.getTime() < last.slot.end_at.getTime()) {
        last.slot.end_at = new Date(
          Math.max(last.slot.end_at.getTime(), p.slot.end_at.getTime())
        );
        last.uids.push(...p.uids);
      } else {
        merged.push(p);
      }
    }

    events.push({
      org_id: orgId,
      event_date: date,
      event_type: 'game',
      source_game_ids: merged.flatMap((m) => m.uids),
      slots: merged.map((m) => m.slot),
    });
  }

  return events;
}
