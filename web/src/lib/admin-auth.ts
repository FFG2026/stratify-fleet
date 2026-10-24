import 'server-only';
import { getAdminEnv } from '@/lib/env';

export class AdminAuthError extends Error { status = 400; }

async function call(path: string, method: string, body: unknown) {
  const env = getAdminEnv();
  if (!env) { const e = new AdminAuthError('Creating logins is not set up yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.'); e.status = 503; throw e; }
  const res = await fetch(env.url + '/auth/v1/admin/' + path, {
    method, cache: 'no-store',
    headers: { apikey: env.serviceKey, Authorization: 'Bearer ' + env.serviceKey, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as { msg?: string; message?: string; error_code?: string; id?: string };
  if (!res.ok) {
    // Auth messages are generic enough to show, except details we never want to echo.
    const known = json.error_code === 'email_exists' || json.error_code === 'user_already_exists';
    throw new AdminAuthError(known ? 'That email already has a login. Add them without a password instead.' : (json.msg || json.message || 'Unable to create the login.'));
  }
  return json;
}

// The login is confirmed at once and flagged (in app_metadata, which people cannot edit themselves) to choose a new password at first sign-in.
export const createLogin = (email: string, password: string) =>
  call('users', 'POST', { email, password, email_confirm: true, app_metadata: { must_change_password: true } });
export const clearMustChange = (userId: string) =>
  call('users/' + encodeURIComponent(userId), 'PUT', { app_metadata: { must_change_password: false } });
