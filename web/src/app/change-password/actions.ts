'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { clearMustChange } from '@/lib/admin-auth';
import { passwordProblem } from '@/lib/password';

export type PasswordState = { error: string } | null;

export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const password = String(form.get('password') ?? ''), again = String(form.get('again') ?? '');
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const problem = passwordProblem(password, again, data.user.email);
  if (problem) return { error: problem };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: /different/i.test(error.message) ? 'Choose a password different from the temporary one.' : 'Unable to change the password. Try a longer, less common one.' };
  try { await clearMustChange(data.user.id); } catch { return { error: 'Your password was changed, but the account could not be released. Ask your administrator.' }; }
  await supabase.auth.refreshSession();
  redirect('/');
}
