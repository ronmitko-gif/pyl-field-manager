import 'server-only';

type EmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const FROM = 'PYL Field Manager <noreply@poweryourleague.com>';

export async function sendEmail(input: EmailInput): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id: string };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
