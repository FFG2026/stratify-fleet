import 'server-only';
import { getAdminEnv } from '@/lib/env';
import { emailConfigured, sendEmail } from '@/lib/email';
import { staticSiteUrl } from '@/lib/site';

// Emails carry only a headline and a link. Claim details, names and amounts stay inside the portal.
const footer = (site: string) => `${site ? `\n\nSign in to Stratify: ${site}` : ''}\n\nYou are receiving this because of your role in the portal. Do not reply to this email.`;

export async function emailClaimNotifications(claimId: string, site = staticSiteUrl()) {
  const env = getAdminEnv();
  if (!env || !emailConfigured()) return;
  try {
    const res = await fetch(env.url + '/rest/v1/rpc/claim_notification_emails', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { apikey: env.serviceKey, Authorization: 'Bearer ' + env.serviceKey, 'content-type': 'application/json' },
      body: JSON.stringify({ p_claim: claimId })
    });
    if (!res.ok) { console.error('email: could not list recipients', res.status); return; }
    const rows = (await res.json()) as { email: string; title: string }[];
    await Promise.all(rows.map(r => sendEmail(r.email, r.title.replace(/[\r\n]+/g, ' '), `${r.title}${site ? `\n\nOpen the claim here: ${site}/claims/${claimId}` : ''}${footer(site)}`)));
  } catch (error) { console.error('email: claim notifications failed', error instanceof Error ? error.message : 'unknown'); }
}

export async function emailAccess(email: string, organisation: string, roleLabel: string, hasTemporaryPassword: boolean, site = staticSiteUrl()) {
  if (!emailConfigured()) return;
  const how = hasTemporaryPassword
    ? 'Sign in with this email address and the temporary password your administrator gave you. You will be asked to choose your own password.'
    : 'Sign in with your email address. If you do not have a login yet, ask your administrator to set one up for you.';
  await sendEmail(email, `You have access to ${organisation} on Stratify`, `You have been given access to ${organisation} on Stratify as ${roleLabel}.\n\n${how}${footer(site)}`);
}
