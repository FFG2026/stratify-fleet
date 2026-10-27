'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { emailAccess } from '@/lib/notify-email';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rest, rpc } from '@/lib/rest';
import { requireContext, messageOf } from '@/lib/session';
import { londonDate, effectiveFrom, monthBounds, normaliseRegistration, parseDate } from '@/lib/dates';
import { checkedId } from '@/lib/ids';
import { getFleetPage } from '@/lib/data';
import { memberEmail, memberRole, roleLabels } from '@/lib/members';
import { createLogin } from '@/lib/admin-auth';
import { createLimiter, lookupVehicle, type VehicleSummary } from '@/lib/vehicle-lookup';
import { parseVehicleCsv, makeModel, type BulkRow } from '@/lib/bulk-vehicles';
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
    if (data.starts_on < londonDate(new Date())) return { ok: false, message: 'Cover cannot be backdated. Choose today or a later date.' };
    const policies = await rest<{ id: string; fleet_id: string }[]>('/rest/v1/policies?select=id,fleet_id&id=eq.' + checkedId(data.policy_id));
    if (!policies.length) return { ok: false, message: 'Policy not accessible.' };
    await rpc('add_vehicle_cover', {
      p_fleet_id: policies[0].fleet_id, p_policy_id: data.policy_id, p_registration: registration,
      p_make_model: `${data.make} ${data.model}`.trim().slice(0, 200), p_effective_at: effectiveFrom(data.starts_on)
    });
    refresh();
    return done('Coverage change recorded and added to the audit trail.');
  } catch (error) { return fail(error); }
}

// ---- bulk add: a CSV of vehicles onto one policy. Each row goes through add_vehicle_cover, so the database still checks
// permission, tenant, policy dates and registration format for every vehicle. Nothing is written in preview mode.
export type BulkRowResult = BulkRow & { added: boolean };
export type BulkResult = { ok: boolean; message: string; rows?: BulkRowResult[]; stage?: 'preview' | 'imported' };
const bulkAllowed = createLimiter(30);
export async function bulkVehicles(form: FormData): Promise<BulkResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const mode = form.get('mode') === 'import' ? 'import' : 'preview';
    const data = z.object({ policy_id: z.string().uuid('Select a policy.'), starts_on: z.string() }).parse(Object.fromEntries(form));
    parseDate(data.starts_on);
    if (data.starts_on < londonDate(new Date())) return { ok: false, message: 'Cover cannot be backdated. Choose today or a later date.' };
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
    if (file.size > 300_000) return { ok: false, message: 'That file is too large. A list of vehicles should be well under 300 KB.' };
    const parsed = parseVehicleCsv(await file.text());
    if (parsed.fileError) return { ok: false, message: parsed.fileError };
    const bad = parsed.rows.filter(r => r.error).length;
    if (mode === 'preview') {
      return { ok: true, stage: 'preview', rows: parsed.rows.map(r => ({ ...r, added: false })), message: bad ? `${parsed.rows.length - bad} of ${parsed.rows.length} rows are ready. Fix the ${bad} marked row${bad === 1 ? '' : 's'} and choose the file again, or add the ready rows now.` : `All ${parsed.rows.length} rows are ready to add.` };
    }
    if (!bulkAllowed(ctx.user.id)) return { ok: false, message: 'Too many uploads just now. Try again in a few minutes.' };
    const policies = await rest<{ id: string; fleet_id: string }[]>('/rest/v1/policies?select=id,fleet_id&id=eq.' + checkedId(data.policy_id));
    if (!policies.length) return { ok: false, message: 'Policy not accessible.' };
    const effective = effectiveFrom(data.starts_on);
    const results: BulkRowResult[] = parsed.rows.map(r => ({ ...r, added: false }));
    const todo = results.filter(r => !r.error);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const row = todo[next++];
        try {
          await rpc('add_vehicle_cover', { p_fleet_id: policies[0].fleet_id, p_policy_id: data.policy_id, p_registration: row.registration, p_make_model: makeModel(row), p_effective_at: effective });
          row.added = true;
        } catch (e) { row.error = messageOf(e); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    refresh();
    const added = results.filter(r => r.added).length, failed = results.length - added;
    return { ok: failed === 0, stage: 'imported', rows: results, message: failed ? `${added} added, ${failed} not added. Each vehicle that was added is recorded; the others are listed below with the reason.` : `All ${added} vehicles added and recorded in the audit trail.` };
  } catch (error) { return { ok: false, message: fail(error).message }; }
}

const removeSchema = z.object({ period_id: z.string().uuid('Select a valid coverage period.'), ends_on: z.string() });

export async function removeVehicle(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const data = removeSchema.parse(Object.fromEntries(form));
    parseDate(data.ends_on);
    if (data.ends_on < londonDate(new Date())) return { ok: false, message: 'Cover cannot be backdated. Choose today or a later date.' };
    const periods = await rest<{ vehicle_id: string; cover_start: string; cover_end: string | null; voided_at: string | null }[]>('/rest/v1/coverage_periods?select=*&id=eq.' + data.period_id);
    if (!periods.length) return { ok: false, message: 'Coverage period not accessible.' };
    const p = periods[0];
    if (p.cover_end || p.voided_at) return { ok: false, message: 'This period is already closed or voided.' };
    if (data.ends_on <= londonDate(p.cover_start)) return { ok: false, message: 'Removal must be on a later calendar date.' };
    await rpc('remove_vehicle_cover', { p_vehicle_id: p.vehicle_id, p_effective_at: effectiveFrom(data.ends_on) });
    refresh();
    return done('Coverage change recorded and added to the audit trail.');
  } catch (error) { return fail(error); }
}

// ---- find a vehicle's open cover from what the person has typed (used by the removal form)
export type OpenCover = { id: string; registration: string; vehicle: string; policyId: string; policyRef: string; startsOn: string };
const findAllowed = createLimiter(240);
export async function findOpenCover(query: string, policyId?: string): Promise<{ ok: true; rows: OpenCover[]; total: number } | { ok: false; message: string }> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  if (!findAllowed(ctx.user.id)) return { ok: false, message: 'Too many searches just now. Try again in a moment.' };
  try {
    const q = String(query ?? '').trim();
    if (!q) return { ok: true, rows: [], total: 0 };
    const page = await getFleetPage({ q, status: 'open', policy: policyId || undefined, limit: '8' });
    const ref = (id: string) => ctx.policies.find(p => p.id === id)?.reference ?? '';
    return { ok: true, total: page.total, rows: page.rows.map(r => ({ id: r.id, registration: r.registration, vehicle: r.make, policyId: r.policy_id, policyRef: ref(r.policy_id), startsOn: r.starts_on })) };
  } catch (error) { return { ok: false, message: messageOf(error) }; }
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
export async function generateReport(form: FormData): Promise<ActionResult> {
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
  return { ok: true, message: 'Saved provisional reconciliation generated.', redirectTo: `/reconciliation?month=${month}&policy=${policy}&report=${id}` };
}

// ---- people
const passwordSchema = z.string().min(8, 'The temporary password must be at least 8 characters.').max(72, 'The temporary password is too long (72 characters at most).');

export async function addMember(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const org = checkedId(form.get('org')), email = memberEmail(form.get('email')), role = memberRole(form.get('role'));
    const rawPassword = String(form.get('password') ?? '');
    const password = rawPassword ? passwordSchema.parse(rawPassword) : '';
    if (password && password.toLowerCase().includes(email.split('@')[0])) return { ok: false, message: 'The temporary password must not contain the email name.' };
    // The database checks permission, role and organisation first; nothing is created in Supabase Auth unless that passes.
    const result = await rpc<string>('add_member', { p_org: org, p_email: email, p_role: role });
    revalidatePath('/users');
    after(() => emailAccess(email, ctx.orgs.find(o => o.id === org)?.name ?? 'the portal', roleLabels[role] ?? role, !!password));
    if (result === 'added') return done('Added. They already had a login, so their existing password still works.');
    if (!password) return done('Invitation saved. It applies when they first sign in.');
    try { await createLogin(email, password); }
    catch (error) {
      return { ok: false, message: (error instanceof Error ? error.message : 'Unable to create the login.') + ' The invitation is saved; cancel it or try again with a password.' };
    }
    await rpc('record_member_login', { p_org: org, p_email: email }).catch(() => null);
    return done('Login created. Give them the temporary password; they must choose their own at first sign-in.');
  } catch (error) { return fail(error); }
}
// ---- driver assignments (the database checks permission, fleet and driver role)
export async function assignDriver(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    const org = checkedId(form.get('org')), user = checkedId(form.get('user'));
    const registration = normaliseRegistration(form.get('registration'));
    const from = String(form.get('from') ?? ''); parseDate(from);
    const found = await rest<{ id: string }[]>('/rest/v1/vehicles?select=id&fleet_id=eq.' + org + '&registration=eq.' + encodeURIComponent(registration) + '&limit=1');
    if (!found.length) return { ok: false, message: `${registration} is not a vehicle in this fleet.` };
    await rpc('assign_driver', { p_vehicle: found[0].id, p_user: user, p_from: from });
    revalidatePath('/drivers');
    return done(`${registration} assigned. The driver can see it now.`);
  } catch (error) { return fail(error); }
}
export async function endAssignment(form: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.demo) return { ok: false, message: 'The demo account is read-only.' };
  try {
    await rpc('end_assignment', { p_assignment: checkedId(form.get('assignment')), p_to: londonDate(new Date()) });
    revalidatePath('/drivers');
    return done('Assignment ended today.');
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
