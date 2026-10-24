'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { rpc } from '@/lib/rest';
import { BAD_CODE, codeProblem } from '@/lib/mfa';

export type MfaState = { error: string } | null;

export async function verifyLogin(_prev: MfaState, form: FormData): Promise<MfaState> {
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  const problem = codeProblem(code);
  if (problem) return { error: problem };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/login');
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect('/');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: BAD_CODE };
  // Invitations could not be claimed before the second step; do it now.
  await rpc('claim_invitations', {}).catch(() => null);
  redirect('/');
}
