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
type PeriodRow = { id: string; vehicle_id: string; policy_id: string; cover_start: string; cover_end: string | null; voided_at: string | null; vehicle?: { registration: string; make_model: string | null } };

export const normaliseOrg = (o: OrgRow): Org => ({ id: o.id, name: o.name, kind: o.kind === 'fleet' ? 'customer' : (o.kind as Org['kind']), insurer_id: o.insurer_id });
export const normalisePolicy = (p: PolicyRow): Policy => ({
  id: p.id, reference: p.policy_number, customer_id: p.fleet_id, insurer_id: p.insurer_id,
  starts_on: p.valid_from, ends_on: p.valid_to ? nextDate(p.valid_to) : null
});
export const normalisePeriod = (c: PeriodRow): Period => ({
  id: c.id, vehicle_id: c.vehicle_id, policy_id: c.policy_id, registration: c.vehicle?.registration || 'Unknown',
  make: c.vehicle?.make_model || '', model: '', starts_on: londonDate(c.cover_start), ends_on: c.cover_end ? londonDate(c.cover_end) : null
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
export const isPlatform = (ctx: Context) => ctx.demo || rolesOf(ctx).includes('platform_super_admin');
export const isInsurerSide = (ctx: Context) => ctx.demo || rolesOf(ctx).some(r => r === 'platform_super_admin' || r.startsWith('insurer_'));
export function manageableOrgs(ctx: Context): Org[] {
  const active = ctx.memberships.filter(m => m.active);
  if (active.some(m => m.role === 'platform_super_admin')) return ctx.orgs;
  const own = new Set(active.filter(m => ['insurer_admin', 'fleet_admin'].includes(m.role)).map(m => m.organisation_id));
  return ctx.orgs.filter(o => own.has(o.id) || (o.kind === 'customer' && o.insurer_id !== null && own.has(o.insurer_id)));
}
export const orgName = (ctx: Context, id: string | null | undefined) => ctx.orgs.find(o => o.id === id)?.name || '—';
export const homeFor = (ctx: Context) => (isPlatform(ctx) ? '/overview' : isInsurerSide(ctx) ? '/insurer' : '/customer');

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
