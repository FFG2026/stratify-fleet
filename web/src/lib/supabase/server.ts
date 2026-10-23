import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';
import { sessionCookie } from './cookies';

// Server-only Supabase client bound to the signed-in person's cookies. It uses the PUBLISHABLE key only;
// every query therefore runs as that person and row-level security decides what they can see.
export async function createClient() {
  const env = getEnv();
  if (!env) throw new Error('The database is not configured.');
  const store = await cookies();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: list => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, sessionCookie(options))); }
        catch { /* called from a Server Component; the proxy refreshes the session instead */ }
      }
    }
  });
}
