import { createClient } from '@/lib/supabase/server';
import { getEnv } from '@/lib/env';

export class RestError extends Error { constructor(message: string, public status: number) { super(message); } }

// Calls the database's REST interface as the signed-in person (their own token, the publishable key as API key).
// Row-level security and the permission checks inside each database function decide what comes back.
export async function accessToken(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new RestError('Please sign in again.', 401);
  return data.session.access_token;
}

type Options = { method?: string; body?: unknown; count?: boolean };

export async function rest<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const env = getEnv();
  if (!env) throw new RestError('The database is not configured.', 503);
  const token = await accessToken();
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const response = await fetch(env.url + path, {
    method,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: env.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
      ...(options.count ? { Prefer: 'count=exact' } : {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* empty or non-JSON body */ }
  const range = response.headers.get('content-range')?.split('/')[1];
  const total = range && /^\d+$/.test(range) ? Number(range) : null;
  if (response.status === 416 && options.count && total !== null) return { rows: [], total } as T;
  if (!response.ok) {
    const message = (data as { message?: string } | null)?.message;
    throw new RestError(response.status === 401 ? 'Please sign in again.' : message || 'Database request failed.', response.status);
  }
  if (options.count) {
    if (total === null) throw new RestError('The database did not return a result count.', 502);
    return { rows: (data ?? []) as unknown[], total } as T;
  }
  return data as T;
}

export const rpc = <T = unknown>(name: string, args: Record<string, unknown>) => rest<T>('/rest/v1/rpc/' + name, { body: args });

// Reads every row of a table in pages of 500 (organisations and policies are small).
export async function allRows<T>(table: string, query = 'order=id.asc'): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await rest<T[]>(`/rest/v1/${table}?select=*&${query}&offset=${offset}&limit=500`);
    rows.push(...batch);
    if (batch.length < 500) return rows;
    if (offset >= 100000) throw new RestError('Please narrow the report.', 422);
  }
}
// A count only (HEAD request), so large tables are never downloaded to be counted.
export async function countRows(table: string, query: string): Promise<number> {
  const env = getEnv();
  if (!env) throw new RestError('The database is not configured.', 503);
  const token = await accessToken();
  const response = await fetch(`${env.url}/rest/v1/${table}?select=id&${query}`, {
    method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { apikey: env.key, Authorization: 'Bearer ' + token, Prefer: 'count=exact' }
  });
  const range = response.headers.get('content-range')?.split('/')[1];
  if (!response.ok && response.status !== 416) throw new RestError('Database request failed.', response.status);
  if (!range || !/^\d+$/.test(range)) throw new RestError('The database did not return a result count.', 502);
  return Number(range);
}
