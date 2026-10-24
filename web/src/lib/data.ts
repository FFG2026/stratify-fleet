import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { demoAccountEmail } from '@/lib/env';
import { allRows, countRows, rest, rpc } from '@/lib/rest';
import { londonDate, nextDate, monthBounds } from '@/lib/dates';
import { fleetQuery, historyQuery, type Params } from '@/lib/queries';
import { checkedId } from '@/lib/ids';
import { demoOrgs, demoPolicies } from '@/lib/demo';
import type { Context, FleetOverviewRow, Member, Membership, Org, Page, Period, Policy, Report, ReportLine } from '@/lib/types';

type OrgRow = { id: string; name: string; kind: string; insurer_id: string | null };
type PolicyRow = { id: string; policy_number: string; fleet_id: string; insurer_id: string; valid_from: string; valid_to: string | null };
type PeriodRow = { id: string; vehicle_id: string; policy_id: string; cover_start: string; cover_end: string | null; created_at?: string; first_recorded_at?: string | null; voided_at: string | null; vehicle?: { registration: string; make_model: string | null } };

export const normaliseOrg = (o: OrgRow): Org => ({ id: o.id, name: o.name, kind: o.kind === 'fleet' ? 'customer' : (o.kind as Org['kind']), insurer_id: o.insurer_id });
export const normalisePolicy = (p: PolicyRow): Policy => ({
  id: p.id, reference: p.policy_number, customer_id: p.fleet_id, insurer_id: p.insurer_id,
  starts_on: p.valid_from, ends_on: p.valid_to ? nextDate(p.valid_to) : null
});
export const normalisePeriod = (c: PeriodRow): Period => ({
  id: c.id, vehicle_id: c.vehicle_id, policy_id: c.policy_id, registration: c.vehicle?.registration || 'Unknown',
  make: c.vehicle?.make_model || '', model: '', starts_on: londonDate(c.cover_start), ends_on: c.cover_end ? londonDate(c.cover_end) : null, recorded_at: c.first_recorded_at ?? c.created_at
});

// Signed-in person, their organisations, policies and memberships. Cached for the duration of one request.
export const getContext = cache(async (): Promise<Context | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const email = user.email ?? '';
  const demo = email.toLowerCase() === demoAccountEmail() && !!user.email_confirmed_at;
  if (demo) return { user: { id: user.id, email }, demo: true, orgs: demoOrgs, policies: demoPolicies, memberships: [] };
  const [orgs, policies, memberships] = await Promise.all([
    allRows<OrgRow>('organisations'), allRows<PolicyRow>('policies'),
    rest<Membership[]>(`/rest/v1/memberships?select=organisation_id,role,active&user_id=eq.${user.id}`)
  ]);
  return { user: { id: user.id, email, mustChangePassword: user.app_metadata?.must_change_password === true }, demo: false, orgs: orgs.map(normaliseOrg), policies: policies.map(normalisePolicy), memberships };
});

export const rolesOf = (ctx: Context) => ctx.memberships.filter(m => m.active).map(m => m.role);
export const canChange = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin', 'fleet_admin', 'fleet_manager'].includes(r));
export const canManageUsers = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin', 'fleet_admin'].includes(r));
export const canGenerate = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin', 'insurer_accounts', 'fleet_admin', 'fleet_accounts'].includes(r));
export const canViewRates = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin', 'insurer_accounts'].includes(r));
export const canManageRates = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin'].includes(r));
export const canCreateCustomers = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin'].includes(r));
export const isPlatform = (ctx: Context) => ctx.demo || rolesOf(ctx).includes('platform_super_admin');
export const isInsurerSide = (ctx: Context) => ctx.demo || rolesOf(ctx).some(r => r === 'platform_super_admin' || r.startsWith('insurer_'));
export function manageableOrgs(ctx: Context): Org[] {
  const active = ctx.memberships.filter(m => m.active);
  if (active.some(m => m.role === 'platform_super_admin')) return ctx.orgs;
  const own = new Set(active.filter(m => ['insurer_admin', 'fleet_admin'].includes(m.role)).map(m => m.organisation_id));
  return ctx.orgs.filter(o => own.has(o.id) || (o.kind === 'customer' && o.insurer_id !== null && own.has(o.insurer_id)));
}
export const orgName = (ctx: Context, id: string | null | undefined) => ctx.orgs.find(o => o.id === id)?.name || '—';
// A person whose only access is as a driver sees the driver workspace, not the fleet's.
export const isInsurerOnly = (ctx: Context) => !ctx.demo && rolesOf(ctx).length > 0 && rolesOf(ctx).every(r => r.startsWith('insurer_'));
export const canSearchNational = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin', 'insurer_claims'].includes(r));
export const isDriverOnly = (ctx: Context) => !ctx.demo && rolesOf(ctx).length > 0 && rolesOf(ctx).every(r => r === 'driver');
export const homeFor = (ctx: Context) => (isDriverOnly(ctx) ? '/driver' : isPlatform(ctx) ? '/overview' : isInsurerSide(ctx) ? '/insurer' : '/customer');

// ---- fleet register and removal list
export async function getFleetPage(params: Params): Promise<Page<Period>> {
  const { query, offset, limit } = fleetQuery(params);
  const page = await rest<{ rows: PeriodRow[]; total: number }>('/rest/v1/coverage_periods?' + query, { count: true });
  return { rows: page.rows.filter(r => !r.voided_at).map(normalisePeriod), total: page.total, offset, limit };
}

// Plain-language names for the cover changes shown in the activity panel.
const coverageActionLabels: Record<string, string> = { 'coverage.added': 'Cover added', 'coverage.removed': 'Cover removed', 'coverage.voided': 'Entry voided' };

// Cover changes only (not membership set-up), newest first, with plain-language labels.
export async function getCoverActivity(limit = 25) {
  const audit = await rest<{ id: number; occurred_at: string; action: string; entity_type: string; before_state: { registration?: string } | null; after_state: { registration?: string } | null }[]>(
    '/rest/v1/audit_logs?select=*&action=in.(coverage.added,coverage.removed,coverage.voided)&order=occurred_at.desc&limit=' + Math.min(Math.max(limit, 1), 100));
  return audit.map(a => ({ id: a.id, registration: a.after_state?.registration || a.before_state?.registration || a.entity_type, action: coverageActionLabels[a.action] ?? a.action.replaceAll('_', ' '), created_at: a.occurred_at }));
}

// ---- customer dashboard figures
export async function getSummary(ctx: Context) {
  const recent = fleetQuery({ limit: '5' }).query, all = fleetQuery({ limit: '1' }).query, active = fleetQuery({ limit: '1', status: 'active' }).query, upcoming = fleetQuery({ limit: '1', status: 'scheduled' }).query;
  const [recentRows, total, covered, scheduled, events] = await Promise.all([
    rest<PeriodRow[]>('/rest/v1/coverage_periods?' + recent),
    countRows('coverage_periods', all.toString()), countRows('coverage_periods', active.toString()), countRows('coverage_periods', upcoming.toString()),
    getCoverActivity(25)
  ]);
  void ctx;
  return { periods: total, covered, scheduled, recent: recentRows.filter(r => !r.voided_at).map(normalisePeriod), events };
}

// ---- vehicles on cover now and who (if anyone) is assigned to each
export type CoveredVehicle = { registration: string; vehicle: string; policy: string; fleet_id: string; cover_start: string; recorded_at: string; drivers: { name: string; since: string }[] };
export async function getCoveredVehicles(ctx: Context): Promise<CoveredVehicle[]> {
  const nowIso = new Date().toISOString(), day = londonDate(new Date());
  const periods = await rest<{ vehicle_id: string; fleet_id: string; policy_id: string; cover_start: string; created_at: string; first_recorded_at: string | null; vehicle: { registration: string; make_model: string | null } }[]>('/rest/v1/coverage_periods?' + new URLSearchParams({
    select: 'vehicle_id,fleet_id,policy_id,cover_start,created_at,first_recorded_at,vehicle:vehicles!inner(registration,make_model)', voided_at: 'is.null', cover_start: 'lte.' + nowIso,
    or: `(cover_end.is.null,cover_end.gt.${nowIso})`, order: 'created_at.desc', limit: '2000' }));
  const assigned = await rest<{ vehicle_id: string; user_id: string; assigned_from: string }[]>('/rest/v1/vehicle_assignments?' + new URLSearchParams({
    select: 'vehicle_id,user_id,assigned_from', assigned_from: 'lte.' + day, or: `(assigned_to.is.null,assigned_to.gte.${day})`, limit: '5000' }));
  let names = new Map<string, string>();
  if (assigned.length) {
    try {
      const ids = [...new Set(assigned.map(a => checkedId(a.user_id)))];
      const profiles = await rest<{ user_id: string; full_name: string }[]>(`/rest/v1/driver_profiles?select=user_id,full_name&user_id=in.(${ids.join(',')})&limit=5000`);
      names = new Map(profiles.map(p => [p.user_id, p.full_name]));
    } catch { /* roles that cannot read driver names still see who is assigned */ }
  }
  return periods.map(p => ({
    registration: p.vehicle.registration, vehicle: p.vehicle.make_model ?? '', policy: ctx.policies.find(x => x.id === p.policy_id)?.reference ?? '', fleet_id: p.fleet_id,
    cover_start: p.cover_start, recorded_at: p.first_recorded_at ?? p.created_at,
    drivers: assigned.filter(a => a.vehicle_id === p.vehicle_id).map(a => ({ name: names.get(a.user_id) ?? 'Assigned driver', since: a.assigned_from }))
  }));
}

// ---- live insurer / platform dashboard
export async function getDashboard(insurer?: string) {
  if (insurer) checkedId(insurer);
  const fleets = (await rest<FleetOverviewRow[]>('/rest/v1/fleet_overview?select=*&order=fleet_name.asc&limit=1000')).filter(f => !insurer || f.insurer_id === insurer);
  const counts = { added7: 0, removed7: 0, scheduledAdds: 0, scheduledRemovals: 0, provisionalReports: 0 };
  if (!fleets.length) return { fleets, counts, events: [] as DashEvent[] };
  const scope = '&fleet_id=in.(' + fleets.map(f => checkedId(f.fleet_id)).join(',') + ')';
  const now = Date.now(), day = 86400000, iso = (ms: number) => encodeURIComponent(new Date(now + ms).toISOString());
  const count = (table: string, query: string) => countRows(table, query + scope);
  const [added7, removed7, scheduledAdds, scheduledRemovals, provisionalReports, events] = await Promise.all([
    count('coverage_events', 'event_type=eq.cover_added&recorded_at=gte.' + iso(-7 * day)),
    count('coverage_events', 'event_type=eq.cover_removed&recorded_at=gte.' + iso(-7 * day)),
    count('coverage_periods', 'voided_at=is.null&cover_start=gt.' + iso(0) + '&cover_start=lte.' + iso(7 * day)),
    count('coverage_periods', 'voided_at=is.null&cover_end=gt.' + iso(0) + '&cover_end=lte.' + iso(7 * day)),
    count('reconciliations', 'status=eq.provisional&generated_at=gte.' + iso(-30 * day)),
    rest<DashEvent[]>('/rest/v1/coverage_events?select=id,fleet_id,event_type,effective_at,recorded_at,details&order=recorded_at.desc&limit=8' + scope)
  ]);
  return { fleets, counts: { added7, removed7, scheduledAdds, scheduledRemovals, provisionalReports }, events };
}
export type DashEvent = { id: string; fleet_id: string; event_type: string; effective_at: string; recorded_at: string; details: { registration?: string } | null };

// ---- reconciliation
export async function getReportHistory(params: Params): Promise<Page<Report>> {
  const { query, offset, limit } = historyQuery(params);
  const page = await rest<{ rows: Report[]; total: number }>('/rest/v1/reconciliations?' + query, { count: true });
  return { ...page, offset, limit };
}
export async function getReport(id: string): Promise<{ report: Report; lines: ReportLine[] } | null> {
  checkedId(id);
  const reports = await rest<Report[]>('/rest/v1/reconciliations?select=*&id=eq.' + id);
  if (!reports.length) return null;
  const lines = await allRows<ReportLine>('reconciliation_lines', 'reconciliation_id=eq.' + id + '&order=id.asc');
  return { report: reports[0], lines };
}

// Live, provisional list of vehicles with cover in a month, read from the register (not a saved report).
// Uses the same date-only rule as the demo preview: start date included, removal date excluded.
export async function getMonthPreview(month: string, policy?: string) {
  const [first, next] = monthBounds(month);
  const day = 86400000, iso = (ms: number) => new Date(ms).toISOString();
  const map = new Map<string, { policy_id: string; registration: string; days: number }>();
  type Row = { policy_id: string; cover_start: string; cover_end: string | null; vehicle: { registration: string } | null };
  let offset = 0, total = Infinity, read = 0;
  // Page by the database's own row count, so a server-side row cap can never silently drop vehicles.
  while (offset < total && offset < 20000) {
    const query = new URLSearchParams({
      select: 'policy_id,cover_start,cover_end,vehicle:vehicles!inner(registration)',
      voided_at: 'is.null',
      cover_start: 'lt.' + iso(next + day),
      or: '(cover_end.is.null,cover_end.gt.' + iso(first - day) + ')',
      order: 'id.asc', offset: String(offset), limit: '500'
    });
    if (policy) query.set('policy_id', 'eq.' + checkedId(policy));
    const page = await rest<{ rows: Row[]; total: number }>('/rest/v1/coverage_periods?' + query, { count: true });
    total = page.total;
    if (!page.rows.length) break;
    offset += page.rows.length; read += page.rows.length;
    for (const r of page.rows) {
      if (!r.vehicle) continue;
      let days = 0;
      try { days = insuredDays(londonDate(r.cover_start), r.cover_end ? londonDate(r.cover_end) : null, month); } catch { continue; }
      if (!days) continue;
      const key = r.policy_id + ':' + r.vehicle.registration, hit = map.get(key);
      if (hit) hit.days += days; else map.set(key, { policy_id: r.policy_id, registration: r.vehicle.registration, days });
    }
  }
  if (Number.isFinite(total) && read < total) throw new Error('The vehicle list is too large to preview. Narrow it to one policy.');
  return [...map.values()].sort((a, b) => a.registration.localeCompare(b.registration));
}

// ---- driver workspace
export type DriverCoverRow = { assignment_id: string; vehicle_id: string; registration: string; make_model: string | null; assigned_from: string; assigned_to: string | null; cover_start: string | null; cover_end: string | null };
export async function getMyCover() { return rpc<DriverCoverRow[]>('my_cover', {}); }
export type Assignment = { id: string; user_id: string; vehicle_id: string; assigned_from: string; assigned_to: string | null; vehicle: { registration: string; make_model: string | null } | null };
export async function getAssignments(fleet: string) {
  return rest<Assignment[]>('/rest/v1/vehicle_assignments?select=id,user_id,vehicle_id,assigned_from,assigned_to,vehicle:vehicles(registration,make_model)&fleet_id=eq.' + checkedId(fleet) + '&order=assigned_from.desc&limit=200');
}

// ---- driver records
export type DriverProfile = { user_id: string; fleet_id: string; full_name: string; date_of_birth: string | null; licence_number: string | null; phone: string | null; no_claims_declared_at: string | null; no_convictions_declared_at: string | null; updated_at: string };
export type DriverDoc = { id: string; user_id: string; kind: string; file_name: string; content_type: string; size_bytes: number; uploaded_at: string; expires_on: string | null };
export type DriverRecord = { id: string; user_id: string; kind: 'employment' | 'claim' | 'conviction'; title: string; detail: string | null; start_date: string; end_date: string | null; amount: number | null; at_fault: boolean | null; points: number | null };
export type DriverConsent = { user_id: string; kind: string; given: boolean; version: string; recorded_at: string };
export type CheckCode = { id: string; code: string; created_at: string; used_at: string | null };
export type LicenceCheck = { id: string; checked_at: string; checked_by_email: string | null; status: string; points: number | null; entitlements: string | null; endorsements: string | null; notes: string | null; next_check_due: string | null };
export type DriverFile = { profile: DriverProfile | null; docs: DriverDoc[]; consents: DriverConsent[]; records: DriverRecord[]; codes: CheckCode[]; checks: LicenceCheck[] };
const docCols = 'id,user_id,kind,file_name,content_type,size_bytes,uploaded_at,expires_on';
const recCols = 'id,user_id,kind,title,detail,start_date,end_date,amount,at_fault,points';

// One driver's whole file. Row-level security limits it to the driver themself, their fleet and the fleet's insurers.
export async function getDriverFile(userId: string): Promise<DriverFile> {
  const u = checkedId(userId);
  const [profiles, docs, consents, records, codes, checks] = await Promise.all([
    rest<DriverProfile[]>('/rest/v1/driver_profiles?select=*&user_id=eq.' + u),
    rest<DriverDoc[]>(`/rest/v1/driver_documents?select=${docCols}&user_id=eq.${u}&order=uploaded_at.desc&limit=100`),
    rest<DriverConsent[]>('/rest/v1/driver_consent_current?select=user_id,kind,given,version,recorded_at&user_id=eq.' + u),
    rest<DriverRecord[]>(`/rest/v1/driver_records?select=${recCols}&user_id=eq.${u}&order=start_date.desc&limit=200`),
    rest<CheckCode[]>(`/rest/v1/driver_check_codes?select=id,code,created_at,used_at&user_id=eq.${u}&order=created_at.desc&limit=10`),
    rest<LicenceCheck[]>(`/rest/v1/licence_checks?select=id,checked_at,checked_by_email,status,points,entitlements,endorsements,notes,next_check_due&user_id=eq.${u}&order=checked_at.desc&limit=50`)
  ]);
  return { profile: profiles[0] ?? null, docs, consents, records, codes, checks };
}

export type DriverRow = DriverProfile & { lastCheck: Pick<LicenceCheck, 'checked_at' | 'status' | 'next_check_due'> | null; docKinds: string[]; licenceCheck: boolean; dataSharing: boolean; jobs: DriverRecord[]; claims: number; convictions: number };
const safeName = (q: string) => q.replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 60);
export async function listDrivers(params: { q?: string; fleet?: string; offset?: number; limit?: number }): Promise<{ rows: DriverRow[]; total: number }> {
  const limit = params.limit ?? 25, offset = params.offset ?? 0;
  const query = new URLSearchParams({ select: '*', order: 'full_name.asc', offset: String(offset), limit: String(limit) });
  const q = safeName(params.q ?? '');
  if (q) query.set('full_name', 'ilike.*' + q + '*');
  if (params.fleet) query.set('fleet_id', 'eq.' + checkedId(params.fleet));
  const page = await rest<{ rows: DriverProfile[]; total: number }>('/rest/v1/driver_profiles?' + query, { count: true });
  if (!page.rows.length) return { rows: [], total: page.total };
  const ids = '(' + page.rows.map(p => checkedId(p.user_id)).join(',') + ')';
  const [docs, consents, records, checks] = await Promise.all([
    rest<{ user_id: string; kind: string }[]>('/rest/v1/driver_documents?select=user_id,kind&user_id=in.' + ids + '&limit=1000'),
    rest<DriverConsent[]>('/rest/v1/driver_consent_current?select=user_id,kind,given,version,recorded_at&user_id=in.' + ids),
    rest<DriverRecord[]>(`/rest/v1/driver_records?select=${recCols}&user_id=in.${ids}&limit=2000`),
    rest<(Pick<LicenceCheck, 'checked_at' | 'status' | 'next_check_due'> & { user_id: string })[]>('/rest/v1/licence_checks?select=user_id,checked_at,status,next_check_due&order=checked_at.desc&limit=2000&user_id=in.' + ids)
  ]);
  const rows = page.rows.map(p => ({
    ...p,
    lastCheck: checks.find(c => c.user_id === p.user_id) ?? null,
    docKinds: docs.filter(d => d.user_id === p.user_id).map(d => d.kind),
    licenceCheck: consents.some(c => c.user_id === p.user_id && c.kind === 'licence_check' && c.given),
    dataSharing: consents.some(c => c.user_id === p.user_id && c.kind === 'data_sharing' && c.given),
    jobs: records.filter(r => r.user_id === p.user_id && r.kind === 'employment'),
    claims: records.filter(r => r.user_id === p.user_id && r.kind === 'claim').length,
    convictions: records.filter(r => r.user_id === p.user_id && r.kind === 'conviction').length
  }));
  return { rows, total: page.total };
}
export async function suggestDrivers(q: string, fleet?: string) {
  const name = safeName(q);
  if (name.length < 2) return [];
  const query = new URLSearchParams({ select: 'user_id,full_name,fleet_id', order: 'full_name.asc', limit: '8', full_name: 'ilike.*' + name + '*' });
  if (fleet) query.set('fleet_id', 'eq.' + checkedId(fleet));
  return rest<{ user_id: string; full_name: string; fleet_id: string }[]>('/rest/v1/driver_profiles?' + query);
}
export async function getDriverDocument(id: string) {
  const rows = await rest<{ id: string; user_id: string; fleet_id: string; storage_path: string; file_name: string; content_type: string }[]>(
    '/rest/v1/driver_documents?select=id,user_id,fleet_id,storage_path,file_name,content_type&id=eq.' + checkedId(id));
  return rows[0] ?? null;
}
export const canViewDrivers = (ctx: Context) => !ctx.demo && rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin', 'insurer_claims', 'fleet_admin', 'fleet_manager'].includes(r));
export const driverFleetOf = (ctx: Context) => ctx.memberships.find(m => m.active && m.role === 'driver')?.organisation_id ?? null;

// ---- members
export async function getMembers(org: string): Promise<Member[]> {
  return rpc<Member[]>('list_members', { p_org: checkedId(org) });
}

// ---- demo account: fictional records served from memory; no database request is made
import { demoPeriods, demoEvents } from '@/lib/demo';
import { insuredDays, today } from '@/lib/dates';
import { pageOptions } from '@/lib/queries';

export function demoSummary() {
  const t = today();
  const covered = demoPeriods.filter(r => r.starts_on <= t && (!r.ends_on || r.ends_on > t)).length;
  return { periods: demoPeriods.length, covered, scheduled: demoPeriods.filter(r => r.starts_on > t).length, recent: demoPeriods.slice(0, 5), events: demoEvents };
}
export function demoFleetPage(params: Params): Page<Period> {
  const { offset, limit } = pageOptions(params);
  const t = today(), q = (params.q || '').toLowerCase(), status = params.status || 'all';
  const rows = demoPeriods.filter(r => (!params.policy || r.policy_id === params.policy)
    && (!q || (r.registration + ' ' + r.make + ' ' + r.model).toLowerCase().includes(q))
    && (status === 'all' || (status === 'active' ? r.starts_on <= t && (!r.ends_on || r.ends_on > t) : status === 'closed' ? !!r.ends_on : status === 'scheduled' ? r.starts_on > t : !r.ends_on)));
  return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
}
export const fleetRegister = (ctx: Context, params: Params) => (ctx.demo ? Promise.resolve(demoFleetPage(params)) : getFleetPage(params));
// Date-only preview for the demo: start included, removal excluded. Real accounts always use stored reports.
export function demoPreview(month: string, policy?: string) {
  const map = new Map<string, { policy_id: string; registration: string; days: number }>();
  for (const r of demoPeriods) {
    if (policy && r.policy_id !== policy) continue;
    const days = insuredDays(r.starts_on, r.ends_on, month);
    if (!days) continue;
    const key = r.policy_id + ':' + r.registration, hit = map.get(key);
    if (hit) hit.days += days; else map.set(key, { policy_id: r.policy_id, registration: r.registration, days });
  }
  return [...map.values()];
}
