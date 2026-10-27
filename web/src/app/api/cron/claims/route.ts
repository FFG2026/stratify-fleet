import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { getAdminEnv } from '@/lib/env';
import { emailConfigured, sendEmail } from '@/lib/email';
import { emailClaimNotifications } from '@/lib/notify-email';
import { staticSiteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

// Run once a day by Vercel Cron (see vercel.json). It (1) reminds fleets whose requests are past their due date and (2) emails
// insurer staff a short count of what needs them. Emails carry counts and a link only, never claim details.
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function call<T>(env: { url: string; serviceKey: string }, fn: string): Promise<T> {
  const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { apikey: env.serviceKey, Authorization: 'Bearer ' + env.serviceKey, 'content-type': 'application/json' }, body: '{}'
  });
  if (!res.ok) throw new Error(`${fn} failed (${res.status})`);
  return (await res.json()) as T;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: 'not configured' }, { status: 503 });
  if (!same(request.headers.get('authorization') ?? '', 'Bearer ' + secret)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const env = getAdminEnv();
  if (!env) return Response.json({ error: 'not configured' }, { status: 503 });
  const site = staticSiteUrl();
  const out = { reminded: 0, digests: 0, errors: [] as string[] };
  try {
    const rows = await call<{ claim_id: string }[]>(env, 'run_overdue_reminders');
    const ids = [...new Set(rows.map(r => r.claim_id))];
    out.reminded = ids.length;
    for (const id of ids) await emailClaimNotifications(id, site);
  } catch (e) { out.errors.push(e instanceof Error ? e.message : 'reminders failed'); }
  try {
    if (emailConfigured()) {
      const rows = await call<{ email: string; unassigned: number; replies: number; waiting: number; past_due: number }[]>(env, 'insurer_digest');
      for (const r of rows) {
        const lines = [
          r.unassigned ? `${r.unassigned} open claim${r.unassigned === 1 ? ' has' : 's have'} nobody assigned` : '',
          r.replies ? `${r.replies} claim${r.replies === 1 ? ' has' : 's have'} had a reply from a fleet in the last day` : '',
          r.waiting ? `${r.waiting} claim${r.waiting === 1 ? ' is' : 's are'} waiting on a fleet${r.past_due ? ` (${r.past_due} past the due date you set)` : ''}` : ''
        ].filter(Boolean);
        if (!lines.length) continue;
        const ok = await sendEmail(r.email, 'Your Stratify claims summary', `Good morning.\n\n${lines.map(l => '• ' + l).join('\n')}${site ? `\n\nOpen your claims inbox: ${site}/claims` : ''}\n\nYou can turn this email off from the claims inbox in the portal. Do not reply to this email.`);
        if (ok) out.digests++;
      }
    }
  } catch (e) { out.errors.push(e instanceof Error ? e.message : 'digest failed'); }
  return Response.json(out, { status: out.errors.length ? 500 : 200 });
}
