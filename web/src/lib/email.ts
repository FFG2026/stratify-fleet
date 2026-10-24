import 'server-only';

// Email sending, provider-agnostic at the call sites. Today it talks to Resend (https://resend.com) over HTTPS.
// With no RESEND_API_KEY and EMAIL_FROM it does nothing, so the portal works without email and nothing breaks.
export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || /[\r\n]/.test(subject)) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: subject.slice(0, 200), text })
    });
    if (!res.ok) console.error('email: provider refused', res.status);
    return res.ok;
  } catch (error) { console.error('email: send failed', error instanceof Error ? error.message : 'unknown'); return false; }
}
