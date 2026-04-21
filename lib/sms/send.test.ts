import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendSms } from './send';

describe('sendSms', () => {
  const originalMode = process.env.TWILIO_MODE;
  const originalSid = process.env.TWILIO_ACCOUNT_SID;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;
  const originalFrom = process.env.TWILIO_FROM_NUMBER;

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
  });

  afterEach(() => {
    process.env.TWILIO_MODE = originalMode;
    process.env.TWILIO_ACCOUNT_SID = originalSid;
    process.env.TWILIO_AUTH_TOKEN = originalToken;
    process.env.TWILIO_FROM_NUMBER = originalFrom;
    vi.restoreAllMocks();
  });

  it('dev mode returns success without network', async () => {
    process.env.TWILIO_MODE = 'dev';
    const spy = vi.spyOn(globalThis, 'fetch');
    const result = await sendSms({ to: '+14125550123', body: 'hello' });
    expect(result).toEqual({ ok: true, id: 'dev-logged' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('prod mode POSTs to Twilio and returns the SID on success', async () => {
    process.env.TWILIO_MODE = 'prod';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
    );
    const result = await sendSms({ to: '+14125550123', body: 'hello' });
    expect(result).toEqual({ ok: true, id: 'SM123' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.twilio.com');
    expect(String(url)).toContain('ACtest/Messages.json');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('returns { ok: false, error } when Twilio responds non-2xx', async () => {
    process.env.TWILIO_MODE = 'prod';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('invalid phone', { status: 400 })
    );
    const result = await sendSms({ to: 'nope', body: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('400');
  });

  it('returns error when TWILIO_ACCOUNT_SID is missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    process.env.TWILIO_MODE = 'prod';
    const result = await sendSms({ to: '+14125550123', body: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('TWILIO_ACCOUNT_SID');
  });
});
