import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/New_York';

export type OpenWindow = {
  id: string;
  field_id: string;
  day_of_week: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

export function windowsForDate(
  windows: OpenWindow[],
  fieldId: string,
  dateEt: Date
): OpenWindow[] {
  const local = toZonedTime(dateEt, TZ);
  const dow = local.getDay();
  return windows.filter(
    (w) => w.field_id === fieldId && w.day_of_week === dow
  );
}

function parseTimeOnDate(isoDate: string, hms: string): Date {
  const [h, m] = hms.split(':').map(Number);
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0));
}

export function fitsInWindow(
  window: OpenWindow,
  startAtUtc: Date,
  endAtUtc: Date
): boolean {
  const startEt = toZonedTime(startAtUtc, TZ);
  const endEt = toZonedTime(endAtUtc, TZ);
  if (startEt.getDay() !== window.day_of_week) return false;
  if (endEt.getDay() !== window.day_of_week) return false;

  const isoDate = format(startEt, 'yyyy-MM-dd');
  const winStart = parseTimeOnDate(isoDate, window.start_time);
  const winEnd = parseTimeOnDate(isoDate, window.end_time);

  const startEtAsUtc = new Date(
    Date.UTC(
      startEt.getFullYear(),
      startEt.getMonth(),
      startEt.getDate(),
      startEt.getHours(),
      startEt.getMinutes(),
      0
    )
  );
  const endEtAsUtc = new Date(
    Date.UTC(
      endEt.getFullYear(),
      endEt.getMonth(),
      endEt.getDate(),
      endEt.getHours(),
      endEt.getMinutes(),
      0
    )
  );

  return startEtAsUtc >= winStart && endEtAsUtc <= winEnd;
}
