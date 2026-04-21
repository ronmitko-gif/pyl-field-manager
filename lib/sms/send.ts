import 'server-only';

type SmsInput = { to: string; body: string };

type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type Mode = 'dev' | 'test' | 'prod';

function modeOf(): Mode {
  const m = (process.env.TWILIO_MODE ?? 'prod').toLowerCase();
  if (m === 'dev' || m === 'test' || m === 'prod') return m;
  return 'prod';
}

export async function sendSms(input: SmsInput): Promise<SendResult> {
  const mode = modeOf();

  if (mode === 'dev') {
    console.log('[sms/dev] to=%s body=%s', input.to, input.body);
    return { ok: true, id: 'dev-logged' };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid) return { ok: false, error: 'TWILIO_ACCOUNT_SID not set' };
  if (!token) return { ok: false, error: 'TWILIO_AUTH_TOKEN not set' };
  if (!from) return { ok: false, error: 'TWILIO_FROM_NUMBER not set' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const basic = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({ From: from, To: input.to, Body: input.body });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { sid: string };
    return { ok: true, id: json.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
