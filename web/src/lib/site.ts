import { headers } from 'next/headers';

// The public address of this portal, used in links sent by email. SITE_URL wins; otherwise the request's own origin.
// Supabase only honours redirect addresses on its allow-list, so a forged host cannot send people elsewhere.
export async function siteUrl(): Promise<string> {
  const fixed = process.env.SITE_URL?.trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
