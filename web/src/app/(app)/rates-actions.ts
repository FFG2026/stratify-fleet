'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { parseDate } from '@/lib/dates';
import type { ActionResult } from '@/components/useAction';

const done = (message: string): ActionResult => ({ ok: true, message });
const fail = (error: unknown): ActionResult => ({ ok: false, message: error instanceof z.ZodError ? error.issues[0]?.message ?? 'Check the details.' : messageOf(error) });
const date = (v: unknown, message: string) => { const s = String(v ?? ''); if (!s) throw new z.ZodError([{ code: 'custom', path: [], message }]); parseDate(s); return s; };
const num = (v: unknown, message: string) => { const s = String(v ?? '').trim(); const n = Number(s); if (!s || !Number.isFinite(n) || n < 0) throw new z.ZodError([{ code: 'custom', path: [], message }]); return n; };
const note = (v: unknown) => String(v ?? '').trim().slice(0, 500) || null;

// Rates and billing rules are the insurer's own figures. The portal supplies no defaults.
export async function addRate(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    await rpc('set_daily_rate', { p_policy_id: checkedId(form.get('policy')), p_effective_from: date(form.get('from'), 'Enter the date the rate applies from.'), p_daily_rate: num(form.get('rate'), 'Enter the daily rate per vehicle as a number, 0 or more.'), p_note: note(form.get('note')) });
    revalidatePath('/rates'); revalidatePath('/reconciliation');
    return done('Rate saved. Earlier rates are kept: a new one applies from its date and never changes past reports.');
  } catch (error) { return fail(error); }
}

export async function addBillingRules(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const choice = (name: string, message: string) => { const v = form.get(name); if (v !== 'yes' && v !== 'no') throw new z.ZodError([{ code: 'custom', path: [], message }]); return v === 'yes'; };
    const dp = Number(form.get('dp'));
    if (!Number.isInteger(dp) || dp < 0 || dp > 4) return { ok: false, message: 'Rounding must be 0 to 4 decimal places.' };
    const tz = String(form.get('timezone') ?? '').trim();
    if (!tz) return { ok: false, message: 'Enter the time zone, for example Europe/London.' };
    await rpc('set_billing_rules', {
      p_insurer_id: checkedId(form.get('insurer')), p_effective_from: date(form.get('from'), 'Enter the date the rules apply from.'),
      p_start_day_charged: choice('start', 'Say whether the day cover starts is charged.'), p_end_day_charged: choice('end', 'Say whether the day cover ends is charged.'),
      p_timezone: tz, p_rounding_dp: dp, p_vat_rate: num(form.get('tax'), 'Enter the tax rate as a fraction (0 if none or not yet confirmed).'), p_note: note(form.get('note')) });
    revalidatePath('/rates'); revalidatePath('/reconciliation');
    return done('Billing rules saved. They apply from that date; earlier rules are kept.');
  } catch (error) { return fail(error); }
}
