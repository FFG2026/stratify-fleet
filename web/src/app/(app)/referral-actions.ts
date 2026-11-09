'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import type { ActionResult } from '@/components/useAction';

const done = (message: string): ActionResult => ({ ok: true, message });
const fail = (error: unknown): ActionResult => ({ ok: false, message: error instanceof z.ZodError ? error.issues[0]?.message ?? 'Check the details.' : messageOf(error) });
const refresh = () => { revalidatePath('/referrals'); revalidatePath('/changes'); revalidatePath('/bordereau'); revalidatePath('/insurer'); revalidatePath('/fleet'); };
const text = (v: unknown) => String(v ?? '').trim().slice(0, 2000);

// The database checks who may decide. These actions only pass the choice on.
export async function decideReferral(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const decision = String(form.get('decision') ?? '');
    if (!['approve', 'query', 'decline'].includes(decision)) return { ok: false, message: 'Choose approve, query or decline.' };
    const message = text(form.get('message'));
    if (decision !== 'approve' && !message) return { ok: false, message: 'Write a message for the customer first.' };
    await rpc('decide_cover_referral', { p_referral: checkedId(form.get('referral')), p_decision: decision, p_message: message || null });
    refresh();
    return done(decision === 'approve' ? 'Authorised. The vehicle is now on cover.' : decision === 'query' ? 'Query sent to the customer.' : 'Declined. The customer has been told.');
  } catch (error) { return fail(error); }
}

export async function respondReferral(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const body = text(form.get('message'));
    if (!body) return { ok: false, message: 'Write your answer first.' };
    await rpc('respond_cover_referral', { p_referral: checkedId(form.get('referral')), p_body: body });
    refresh();
    return done('Answer sent. The request is back with the insurer.');
  } catch (error) { return fail(error); }
}

export async function withdrawReferral(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    await rpc('withdraw_cover_referral', { p_referral: checkedId(form.get('referral')) });
    refresh();
    return done('Request withdrawn.');
  } catch (error) { return fail(error); }
}
