'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { emailAccess } from '@/lib/notify-email';
import { z } from 'zod';
import { rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { checkedId } from '@/lib/ids';
import { parseDate } from '@/lib/dates';
import { memberEmail } from '@/lib/members';
import { createLogin } from '@/lib/admin-auth';
import type { ActionResult } from '@/components/useAction';

const done = (message: string, extra: Partial<ActionResult> = {}): ActionResult => ({ ok: true, message, ...extra });
const fail = (error: unknown): ActionResult => ({ ok: false, message: error instanceof z.ZodError ? error.issues[0]?.message ?? 'Check the details.' : messageOf(error) });
const text = (value: unknown, min: number, max: number, message: string) => { const v = String(value ?? '').trim(); if (v.length < min || v.length > max) throw new z.ZodError([{ code: 'custom', path: [], message }]); return v; };
const optionalDate = (value: unknown) => { const v = String(value ?? ''); if (!v) return null; parseDate(v); return v; };
const password = z.string().min(8, 'The temporary password must be at least 8 characters.').max(72, 'The temporary password is too long (72 characters at most).');

// After the database has saved the organisation and the first administrator's invitation, optionally give that person a login now.
async function firstAdminLogin(org: string, email: string, raw: string): Promise<string> {
  if (!raw) return 'They will be able to sign in as soon as they have a login; the invitation applies on their first sign-in.';
  const pw = password.parse(raw);
  if (pw.toLowerCase().includes(email.split('@')[0])) return 'Saved, but no login was created: the temporary password must not contain the email name.';
  try { await createLogin(email, pw); } catch (error) { return 'Saved, but the login could not be created: ' + (error instanceof Error ? error.message : 'unknown error'); }
  await rpc('record_member_login', { p_org: org, p_email: email }).catch(() => null);
  return 'A login was created. Give them the temporary password; they must choose their own at first sign-in.';
}

export async function createInsurer(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const name = text(form.get('name'), 2, 120, 'Enter the insurer\'s name.'), email = memberEmail(form.get('email'));
    const id = await rpc<string>('create_insurer', { p_name: name, p_admin_email: email });
    const note = await firstAdminLogin(id, email, String(form.get('password') ?? ''));
    after(() => emailAccess(email, name, 'administrator', !!form.get('password')));
    revalidatePath('/', 'layout');
    return done(`${name} was created and ${email} was invited as its administrator. ${note}`);
  } catch (error) { return fail(error); }
}

export async function createCustomer(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const insurer = checkedId(form.get('insurer')), name = text(form.get('name'), 2, 120, 'Enter the customer\'s name.'), email = memberEmail(form.get('email'));
    const id = await rpc<string>('create_customer', { p_insurer: insurer, p_name: name, p_admin_email: email });
    const note = await firstAdminLogin(id, email, String(form.get('password') ?? ''));
    after(() => emailAccess(email, name, 'administrator', !!form.get('password')));
    revalidatePath('/', 'layout');
    return done(`${name} was created and ${email} was invited as its administrator. ${note}`, { redirectTo: '/organisations/' + id });
  } catch (error) { return fail(error); }
}

export async function createPolicy(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const fleet = checkedId(form.get('fleet')), from = optionalDate(form.get('from')), to = optionalDate(form.get('to'));
    if (!from) return { ok: false, message: 'Enter the date the policy starts.' };
    await rpc('create_policy', { p_fleet: fleet, p_number: text(form.get('number'), 2, 60, 'Enter the policy number.'), p_name: String(form.get('name') ?? '').trim().slice(0, 120), p_from: from, p_to: to });
    revalidatePath('/', 'layout');
    return done('Policy added. Vehicles can now be put on cover under it.');
  } catch (error) { return fail(error); }
}

export async function endPolicy(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const to = optionalDate(form.get('to'));
    if (!to) return { ok: false, message: 'Enter the last day of the policy.' };
    await rpc('end_policy', { p_policy: checkedId(form.get('policy')), p_valid_to: to });
    revalidatePath('/', 'layout');
    return done('The last day of the policy was set. Vehicles still on cover are not changed: renew the policy or take them off cover.');
  } catch (error) { return fail(error); }
}

export async function renewPolicy(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const from = optionalDate(form.get('from')), to = optionalDate(form.get('to'));
    if (!from) return { ok: false, message: 'Enter the date the new policy starts.' };
    const rate = String(form.get('rate') ?? '').trim();
    if (rate && !(Number(rate) >= 0)) return { ok: false, message: 'Enter the daily rate as a number, or leave it empty.' };
    await rpc('renew_policy', { p_policy: checkedId(form.get('policy')), p_new_number: text(form.get('number'), 2, 60, 'Enter the new policy number.'), p_from: from, p_to: to, p_rate: rate ? Number(rate) : null });
    revalidatePath('/', 'layout');
    return done('Renewed. Every vehicle on cover moved to the new policy with no gap, and each keeps its original "added to portal" time.');
  } catch (error) { return fail(error); }
}

export async function changeInsurer(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    await rpc('change_customer_insurer', { p_fleet: checkedId(form.get('fleet')), p_new_insurer: checkedId(form.get('insurer')), p_note: text(form.get('note'), 3, 500, 'Say why the customer is moving.') });
    revalidatePath('/', 'layout');
    return done('The customer now belongs to the new insurer.');
  } catch (error) { return fail(error); }
}
