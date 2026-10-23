import { redirect } from 'next/navigation';
import { getContext } from '@/lib/data';
import type { Context } from '@/lib/types';

// Every server action starts here. The database re-checks permission inside each function; this only avoids useless calls.
export async function requireContext(): Promise<Context> {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  return ctx;
}
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    // Messages from the database functions are written to be shown to people; anything unexpected is generic.
    const known = (error as { status?: number }).status;
    if (known && known >= 400 && known < 500) return error.message;
    if (known === 502 || known === 503) return error.message;
  }
  return 'Unable to complete the request.';
}
