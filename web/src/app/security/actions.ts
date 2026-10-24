'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getContext, rolesOf } from '@/lib/data';
import { BAD_CODE, adminRoles, codeProblem, mfaRequiredForAdmins } from '@/lib/mfa';
import type { ActionResult } from '@/components/useAction';

export type Enrolment = { ok: boolean; message: string; factorId?: string; qr?: string; secret?: string };

export async function startEnrol(): Promise<Enrolment> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ok: false, message: 'Sign in again.' };
  // Clear any half-finished set-up first, so the person never ends up with an unusable second factor.
  for (const f of user.user.factors ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + Math.random().toString(36).slice(2, 8), issuer: 'Stratify' });
  if (error || !data) return { ok: false, message: 'Two-step sign-in could not be started. Try again.' };
  return { ok: true, message: '', factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnrol(factorId: string, code: string): Promise<ActionResult> {
  const clean = String(code ?? '').replace(/\s/g, '');
  const problem = codeProblem(clean);
  if (problem) return { ok: false, message: problem };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: String(factorId), code: clean });
  if (error) return { ok: false, message: BAD_CODE };
  revalidatePath('/security');
  return { ok: true, message: 'Two-step sign-in is on. You will be asked for a code each time you sign in.' };
}

export async function removeFactor(factorId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return { ok: false, message: 'Sign in again.' };
  if (mfaRequiredForAdmins() && rolesOf(ctx).some(r => adminRoles.includes(r))) return { ok: false, message: 'Administrators must keep two-step sign-in on.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: String(factorId) });
  if (error) return { ok: false, message: 'Two-step sign-in could not be turned off. Sign in again with your code, then retry.' };
  revalidatePath('/security');
  return { ok: true, message: 'Two-step sign-in is off.' };
}
