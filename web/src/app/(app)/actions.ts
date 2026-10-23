'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rest, rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { londonDate, londonMidnight, monthBounds, normaliseRegistration, parseDate } from '@/lib/dates';
import { checkedId } from '@/lib/ids';
import { memberEmail, memberRole } from '@/lib/members';
import { createLimiter, lookupVehicle, type VehicleSummary } from '@/lib/vehicle-lookup';
import type { ActionResult } from '@/components/useAction';

const done = (message: string): ActionResult => ({ ok: true, message });
const fail = (error: unknown): ActionResult => ({ ok: false, message: error instanceof z.ZodError ? error.issues[0]?.message ?? 'Check the details.' : messageOf(error) });
const refresh = () => revalidatePath('/', 'layout');

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// ---- cover changes (the database re-checks permission and tenant inside add_vehicle_cover / remove_vehicle_cover)
const addSchema = z.object({
  policy_id: z.string().uuid('Select a valid policy.'),
  registration: z.string().min(1, 'Enter the registration.'),
  starts_on: z.string(),
  make: z.string().trim().min(1, 'Enter the make.').max(100),
  model: z.string().trim().min(1, 'Enter the model.').max(100)
});

export async function addVehicle(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const data = addSchema.parse(Object.fromEntries(form));
    const registration = normaliseRegistration(data.registration);
    parseDate(data.starts_on);
    if (data.starts_on < londonDate(new Date())) return { ok: false, message: 'Backdating approval is not available in this portal yet.' };
    const policies = await rest<{ id: string; fleet_id: string }[]>('/rest/v1/policies?select=id,fleet_id&id=eq.' + checkedId(data.policy_id));
    if (!policies.length) return { ok: false, message: 'Policy not accessible.' };
    await rpc('add_vehicle_cover', {
      p_fleet_id: policies[0].fleet_id, p_policy_id: data.policy_id, p_registration: registration,
      p_make_model: `${data.make} ${data.model}`.trim().slice(0, 200), p_effective_at: londonMidnight(data.starts_on)
    });
    refresh();
    return done('Coverage change recorded and added to the audit trail.');
  } catch (error) { return fail(error); }
}

const removeSchema = z.object({ period_id: z.string().uuid('Select a valid coverage period.'), ends_on: z.string() });

export async function removeVehicle(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const data = removeSchema.parse(Object.fromEntries(form));
    parseDate(data.ends_on);
    if (data.ends_on < londonDate(new Date())) return { ok: false, message: 'Backdating approval is not available in this portal yet.' };
    const periods = await rest<{ vehicle_id: string; cover_start: string; cover_end: string | null; voided_at: string | null }[]>('/rest/v1/coverage_periods?select=*&id=eq.' + data.period_id);
    if (!periods.length) return { ok: false, message: 'Coverage period not accessible.' };
    const p = periods[0];
    if (p.cover_end || p.voided_at) return { ok: false, message: 'This period is already closed or voided.' };
    if (data.ends_on <= londonDate(p.cover_start)) return { ok: false, message: 'Removal must be on a later calendar date.' };
    await rpc('remove_vehicle_cover', { p_vehicle_id: p.vehicle_id, p_effective_at: londonMidnight(data.ends_on) });
    refresh();
    return done('Coverage change recorded and added to the audit trail.');
  } catch (error) { return fail(error); }
}

// ---- registration lookup (DVLA). The key never leaves the server.
const lookupAllowed = createLimiter();
export async function lookupRegistration(registration: string): Promise<{ ok: true; vehicle: VehicleSummary } | { ok: false; message: string }> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'Not available in the demo account.' };
  if (!lookupAllowed(ctx.user.id)) return { ok: false, message: 'Too many lookups just now. Try again in a minute.' };
  try { return { ok: true, vehicle: await lookupVehicle(registration) }; }
  catch (error) { return { ok: false, message: messageOf(error) }; }
}

// ---- reconciliation
export async function generateReport(form: FormData): Promise<ActionResult | void> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  let id: string, month: string, policy: string;
  try {
    month = String(form.get('month') ?? ''); monthBounds(month);
    policy = String(form.get('policy_id') ?? '');
    if (!policy) return { ok: false, message: 'Select one policy to generate a saved report.' };
    checkedId(policy);
    const policies = await rest<{ id: string; fleet_id: string }[]>('/rest/v1/policies?select=id,fleet_id&id=eq.' + policy);
    if (!policies.length) return { ok: false, message: 'Policy not accessible.' };
    id = await rpc<string>('generate_reconciliation', { p_fleet_id: policies[0].fleet_id, p_policy_id: policy, p_month: month + '-01' });
  } catch (error) { return fail(error); }
  refresh();
  redirect(`/reconciliation?month=${month}&policy=${policy}&report=${id}`);
}

// ---- people
export async function addMember(form: FormData): Promise<ActionResult> {
  await requireContext();
  try {
    const result = await rpc<string>('add_member', { p_org: checkedId(form.get('org')), p_email: memberEmail(form.get('email')), p_role: memberRole(form.get('role')) });
    revalidatePath('/users');
    return done(result === 'added' ? 'Added. They have access now.' : 'Invitation saved. It applies when they first sign in.');
  } catch (error) { return fail(error); }
}
export async function changeMemberRole(form: FormData): Promise<ActionResult> {
  await requireContext();
  try {
    await rpc('change_member_role', { p_membership: checkedId(form.get('membership')), p_role: memberRole(form.get('role')) });
    revalidatePath('/users');
    return done('Role updated and recorded in the audit trail.');
  } catch (error) { return fail(error); }
}
export async function setMemberActive(form: FormData): Promise<ActionResult> {
  await requireContext();
  try {
    const active = form.get('active') === 'true';
    await rpc('set_member_active', { p_membership: checkedId(form.get('membership')), p_active: active });
    revalidatePath('/users');
    return done(active ? 'Access restored.' : 'Access switched off.');
  } catch (error) { return fail(error); }
}
export async function revokeInvitation(form: FormData): Promise<ActionResult> {
  await requireContext();
  try {
    await rpc('revoke_invitation', { p_invitation: checkedId(form.get('invitation')) });
    revalidatePath('/users');
    return done('Invitation cancelled.');
  } catch (error) { return fail(error); }
}
