'use server';
import { createClient } from '@/lib/supabase/server';
import { demoAccountEmail } from '@/lib/env';
import { siteUrl } from '@/lib/site';

export type ForgotState = { error?: string; sent?: boolean } | null;

// The answer is the same whether or not the address has an account, so this form cannot be used to find out who is registered.
export async function requestReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = String(form.get('email') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return { error: 'Enter your email address.' };
  if (email.toLowerCase() !== demoAccountEmail()) {
    try {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: (await siteUrl()) + '/auth/callback?next=/reset-password' });
    } catch { /* same answer either way */ }
  }
  return { sent: true };
}
