'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { clearMustChange } from '@/lib/admin-auth';
import { getAdminEnv } from '@/lib/env';
import { passwordProblem } from '@/lib/password';

export type ResetState = { error: string } | null;

export async function resetPassword(_prev: ResetState, form: FormData): Promise<ResetState> {
  const password = String(form.get('password') ?? ''), again = String(form.get('again') ?? '');
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/forgot-password?expired=1');
  const problem = passwordProblem(password, again, data.user.email);
  if (problem) return { error: problem };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: /different/i.test(error.message) ? 'Choose a password different from your current one.' : 'Unable to change the password. Try a longer, less common one.' };
  // A temporary password has just been replaced by one the person chose, so release the "must change" flag when we are able to.
  if (getAdminEnv() && data.user.app_metadata?.must_change_password === true) await clearMustChange(data.user.id).catch(() => null);
  await supabase.auth.refreshSession();
  redirect('/');
}
