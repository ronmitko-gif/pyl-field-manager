import ical, { type VEvent } from 'node-ical';
import type { NormalizedEvent } from '@/lib/types';

function splitDescription(description: string) {
  const parts = description.split(' > ');
  if (parts.length !== 2) return { park: null, field_name: null };
  return { park: parts[0].trim(), field_name: parts[1].trim() };
}

function splitSummary(summary: string) {
  const parts = summary.split(' @ ');
  if (parts.length !== 2) {
    return { away_team_raw: null, home_team_raw: null };
  }
  return {
    away_team_raw: parts[0].trim(),
    home_team_raw: parts[1].trim(),
  };
}

export function parseIcal(icsText: string): NormalizedEvent[] {
  const parsed = ical.sync.parseICS(icsText);
  const events: NormalizedEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const entry = parsed[key];
    if (!entry || entry.type !== 'VEVENT') continue;
    const vevent = entry as VEvent;
    const uid = typeof vevent.uid === 'string' ? vevent.uid : null;
    if (!uid || !vevent.start || !vevent.end) continue;
    const summary = typeof vevent.summary === 'string' ? vevent.summary : '';
    const description =
      typeof vevent.description === 'string' ? vevent.description : '';
    const { park, field_name } = splitDescription(description);
    const { away_team_raw, home_team_raw } = splitSummary(summary);
    events.push({
      uid,
      start_at: new Date(vevent.start),
      end_at: new Date(vevent.end),
      summary,
      description,
      park,
      field_name,
      away_team_raw,
      home_team_raw,
    });
  }
  return events;
}

export async function fetchAndParseIcal(url: string): Promise<NormalizedEvent[]> {
  const httpsUrl = url.replace(/^webcal:\/\//i, 'https://');
  const res = await fetch(httpsUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`iCal fetch failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseIcal(text);
}
