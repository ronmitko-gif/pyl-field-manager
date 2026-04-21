import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatInTimeZone } from 'date-fns-tz';
import { sendEmail } from '@/lib/email/send';

const TZ = 'America/New_York';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fields.poweryourleague.com';

type Coach = { id: string; name: string; email: string; team_id: string | null };
type Request = {
  id: string;
  start_at: string;
  end_at: string;
  field_id: string;
  requester_coach_id: string;
  admin_note: string | null;
};

async function persistAndSend(
  admin: SupabaseClient,
  params: {
    orgId: string;
    coachId: string;
    requestId: string | null;
    blockId: string | null;
    subject: string;
    html: string;
    to: string;
  }
) {
  const { data: row } = await admin
    .from('notifications')
    .insert({
      org_id: params.orgId,
      coach_id: params.coachId,
      request_id: params.requestId,
      block_id: params.blockId,
      channel: 'email',
      body: params.html.slice(0, 4000),
      status: 'pending',
    })
    .select('id')
    .single();

  const result = await sendEmail({
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  if (row?.id) {
    if (result.ok) {
      await admin
        .from('notifications')
        .update({ status: 'sent', external_id: result.id, sent_at: new Date().toISOString() })
        .eq('id', row.id);
    } else {
      await admin
        .from('notifications')
        .update({ status: 'failed', error_message: result.error })
        .eq('id', row.id);
    }
  }
}

function fmtWhen(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${formatInTimeZone(s, TZ, 'EEE MMM d')}, ${formatInTimeZone(s, TZ, 'h:mm a')}–${formatInTimeZone(e, TZ, 'h:mm a')}`;
}

export async function notifyRequestSubmitted(
  admin: SupabaseClient,
  orgId: string,
  request: Request,
  requester: Coach,
  fieldName: string,
  teamName: string
) {
  const { data: admins } = await admin
    .from('coaches')
    .select('id, email, name')
    .eq('org_id', orgId)
    .eq('role', 'admin');

  const when = fmtWhen(request.start_at, request.end_at);
  const html = `
    <p>A slot request needs your review.</p>
    <ul>
      <li><strong>${requester.name}</strong> (${teamName})</li>
      <li>${fieldName}</li>
      <li>${when}</li>
    </ul>
    <p>Approve or deny: <a href="${SITE}/admin/requests">${SITE}/admin/requests</a></p>
  `;

  for (const a of admins ?? []) {
    if (!a.email) continue;
    await persistAndSend(admin, {
      orgId,
      coachId: a.id,
      requestId: request.id,
      blockId: null,
      subject: `New slot request: ${teamName} on ${formatInTimeZone(new Date(request.start_at), TZ, 'EEE MMM d')}`,
      html,
      to: a.email,
    });
  }
}

export async function notifyRequestApproved(
  admin: SupabaseClient,
  orgId: string,
  request: Request,
  requester: Coach,
  fieldName: string,
  blockId: string
) {
  const when = fmtWhen(request.start_at, request.end_at);
  const html = `
    <p>Your slot is confirmed.</p>
    <p><strong>${fieldName}</strong> — ${when}</p>
    ${request.admin_note ? `<p>Note from admin: ${request.admin_note}</p>` : ''}
    <p>See your schedule: <a href="${SITE}/coach">${SITE}/coach</a></p>
  `;
  await persistAndSend(admin, {
    orgId,
    coachId: requester.id,
    requestId: request.id,
    blockId,
    subject: 'Your slot is confirmed',
    html,
    to: requester.email,
  });
}

export async function notifyRequestDenied(
  admin: SupabaseClient,
  orgId: string,
  request: Request,
  requester: Coach,
  fieldName: string,
  superseded = false
) {
  const when = fmtWhen(request.start_at, request.end_at);
  const reason = superseded
    ? "Another team's request for the same slot was approved first."
    : request.admin_note || 'No reason given.';
  const html = `
    <p>Your slot request was declined.</p>
    <p><strong>${fieldName}</strong> — ${when}</p>
    <p>Reason: ${reason}</p>
    <p>Request another at <a href="${SITE}/coach">${SITE}/coach</a></p>
  `;
  await persistAndSend(admin, {
    orgId,
    coachId: requester.id,
    requestId: request.id,
    blockId: null,
    subject: superseded ? 'Your slot request was declined (slot filled)' : 'Your slot request was declined',
    html,
    to: requester.email,
  });
}
