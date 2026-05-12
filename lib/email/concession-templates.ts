import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fields.poweryourleague.com';

function fmtWhen(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${formatInTimeZone(s, TZ, 'EEEE, MMM d')} · ${formatInTimeZone(s, TZ, 'h:mm a')} – ${formatInTimeZone(e, TZ, 'h:mm a')}`;
}

export function confirmationEmail(params: {
  name: string;
  start_at: string;
  end_at: string;
  location: string;
  cancelToken: string;
}) {
  const when = fmtWhen(params.start_at, params.end_at);
  return {
    subject: `TJYBB Concessions: shift confirmed — ${formatInTimeZone(new Date(params.start_at), TZ, 'EEE MMM d')}`,
    html: `
      <p>Hi ${params.name},</p>
      <p>You're signed up to volunteer at the TJYBB concession stand.</p>
      <p><strong>${when}</strong><br>${params.location}</p>
      <p>Thanks for stepping up — every shift helps the league.</p>
      <p>Need to cancel? <a href="${SITE}/concessions/cancel/${params.cancelToken}">Click here</a></p>
    `,
  };
}

export function reminderEmail(params: {
  name: string;
  start_at: string;
  end_at: string;
  location: string;
  cancelToken: string;
}) {
  const when = `${formatInTimeZone(new Date(params.start_at), TZ, 'h:mm a')} – ${formatInTimeZone(new Date(params.end_at), TZ, 'h:mm a')}`;
  return {
    subject: `TJYBB Concessions reminder — your shift is today`,
    html: `
      <p>Hi ${params.name},</p>
      <p>Quick reminder: your concession-stand shift is <strong>today at ${when}</strong> at ${params.location}.</p>
      <p>Thanks for volunteering!</p>
      <p>Need to cancel? <a href="${SITE}/concessions/cancel/${params.cancelToken}">Click here</a></p>
    `,
  };
}

export function cancellationEmail(params: {
  name: string;
  start_at: string;
  end_at: string;
  location: string;
}) {
  const when = fmtWhen(params.start_at, params.end_at);
  return {
    subject: `TJYBB Concessions: shift cancelled`,
    html: `
      <p>Hi ${params.name},</p>
      <p>Your concession-stand shift on <strong>${when}</strong> at ${params.location} has been cancelled.</p>
      <p>Thanks for letting us know. You can sign up for another shift at any time: <a href="${SITE}/concessions">${SITE}/concessions</a></p>
    `,
  };
}
