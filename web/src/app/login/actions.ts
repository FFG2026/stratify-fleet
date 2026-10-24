'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { demoAccountEmail } from '@/lib/env';
import { rpc } from '@/lib/rest';

export type LoginState = { error: string } | null;

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password || email.length > 254 || password.length > 200) return { error: 'Email and password are required.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for every failure, so the form never reveals whether an email address has an account.
  if (error) return { error: 'Unable to sign in. Check your details.' };
  // Pending invitations for a confirmed email become memberships at first sign-in.
  if (email.toLowerCase() !== demoAccountEmail()) await rpc('claim_invitations', {}).catch(() => null);
  // Someone with two-step sign-in turned on must pass the second step before anything else.
  let needsCode = false;
  try {
    const { data: user } = await supabase.auth.getUser();
    const enrolled = (user.user?.factors ?? []).some(f => f.status === 'verified');
    needsCode = enrolled && (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel !== 'aal2';
  } catch { /* the database refuses data to an unverified session anyway */ }
  redirect(needsCode ? '/mfa' : '/');
}
