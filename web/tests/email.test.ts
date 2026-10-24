import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { emailConfigured, sendEmail } from '@/lib/email';
import { emailAccess, emailClaimNotifications } from '@/lib/notify-email';

const env = { ...process.env };
beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { process.env = { ...env }; });

describe('email', () => {
  it('does nothing without a provider key', async () => {
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(emailConfigured()).toBe(false);
    expect(await sendEmail('a@example.test', 'Hi', 'Body')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('posts a plain-text message to the provider and refuses malformed input', async () => {
    process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'Stratify <no-reply@example.test>';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await sendEmail('a@example.test', 'Hi', 'Body')).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(String(init.body))).toEqual({ from: 'Stratify <no-reply@example.test>', to: ['a@example.test'], subject: 'Hi', text: 'Body' });
    expect(await sendEmail('not-an-email', 'Hi', 'Body')).toBe(false);
    expect(await sendEmail('a@example.test', 'Hi\r\nBcc: x@example.test', 'Body')).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('reports a provider refusal as not sent', async () => {
    process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'x@example.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 422 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendEmail('a@example.test', 'Hi', 'Body')).toBe(false);
  });
  it('claim emails go to each recipient the database returns and carry a headline and link only', async () => {
    process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'x@example.test'; process.env.SUPABASE_URL = 'https://db.example.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes('/rest/v1/rpc/claim_notification_emails')
      ? new Response(JSON.stringify([{ email: 'one@example.test', title: 'New claim from Northbank' }, { email: 'two@example.test', title: 'New claim from Northbank' }]), { status: 200 })
      : new Response('{}', { status: 200 }));
    await emailClaimNotifications('c1', 'https://portal.example.test');
    const sends = fetchSpy.mock.calls.filter(c => String(c[0]).includes('resend'));
    expect(sends).toHaveLength(2);
    const body = JSON.parse(String((sends[0][1] as RequestInit).body));
    expect(body.text).toContain('https://portal.example.test/claims/c1');
    expect(body.text).not.toMatch(/\d{2}:\d{2}/);
    const lookup = fetchSpy.mock.calls.find(c => String(c[0]).includes('claim_notification_emails'))![1] as RequestInit;
    expect((lookup.headers as Record<string, string>).Authorization).toBe('Bearer svc');
  });
  it('an access email never contains a password', async () => {
    process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'x@example.test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await emailAccess('new@example.test', 'Northbank', 'administrator', true, 'https://portal.example.test');
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.text).toContain('temporary password your administrator gave you');
    expect(body.subject).toContain('Northbank');
  });
});
