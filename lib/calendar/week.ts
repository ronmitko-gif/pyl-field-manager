import { addDays, getISOWeek, getISOWeekYear, format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const TZ = 'America/New_York';

export type WeekBounds = {
  start: Date;
  endExclusive: Date;
  param: string;
};

/** ET wall-clock midnight of the given ET date-only string, as a UTC instant. */
function etMidnightToUtc(isoDate: string): Date {
  return fromZonedTime(`${isoDate}T00:00:00`, TZ);
}

/** Monday of the ET week containing the given UTC instant, returned as a UTC instant at ET midnight. */
function mondayFor(d: Date): Date {
  const local = toZonedTime(d, TZ);
  const diff = (local.getDay() + 6) % 7;
  const mondayLocal = addDays(local, -diff);
  return etMidnightToUtc(format(mondayLocal, 'yyyy-MM-dd'));
}

export function boundsForMonday(m: Date): WeekBounds {
  const etMonday = toZonedTime(m, TZ);
  const isoWeek = getISOWeek(etMonday);
  const isoYear = getISOWeekYear(etMonday);
  const nextMondayEt = addDays(etMonday, 7);
  const endExclusive = etMidnightToUtc(format(nextMondayEt, 'yyyy-MM-dd'));
  return {
    start: m,
    endExclusive,
    param: `${isoYear}-W${String(isoWeek).padStart(2, '0')}`,
  };
}

export function currentWeek(): WeekBounds {
  return boundsForMonday(mondayFor(new Date()));
}

export function parseWeekParam(param: string | undefined): WeekBounds {
  if (!param) return currentWeek();
  const m = /^(\d{4})-W(\d{2})$/.exec(param);
  if (!m) return currentWeek();
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO week 1 contains Jan 4. Find Monday-on-or-before Jan 4 in ET.
  const jan4Noon = new Date(Date.UTC(year, 0, 4, 12, 0, 0));
  const jan4Et = toZonedTime(jan4Noon, TZ);
  const diffToMonday = (jan4Et.getDay() + 6) % 7;
  const week1MondayEt = addDays(jan4Et, -diffToMonday);
  const targetMondayEt = addDays(week1MondayEt, (week - 1) * 7);
  const monday = etMidnightToUtc(format(targetMondayEt, 'yyyy-MM-dd'));
  return boundsForMonday(monday);
}

export function formatWeekParam(mondayUtc: Date): string {
  return boundsForMonday(mondayUtc).param;
}

export function nextWeek(w: WeekBounds): WeekBounds {
  return boundsForMonday(w.endExclusive);
}

export function prevWeek(w: WeekBounds): WeekBounds {
  const etMonday = toZonedTime(w.start, TZ);
  const prevMondayEt = addDays(etMonday, -7);
  return boundsForMonday(etMidnightToUtc(format(prevMondayEt, 'yyyy-MM-dd')));
}

export function weekLabel(w: WeekBounds): string {
  const startEt = toZonedTime(w.start, TZ);
  const endEt = addDays(startEt, 6);
  return `${format(startEt, 'MMM d')} – ${format(endEt, 'MMM d, yyyy')}`;
}
