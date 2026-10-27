import 'server-only';
import type { RequestItem } from '@/lib/claim-items';
import { rest, rpc } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { getMyCover, isDriverOnly, isInsurerSide, isTpaOnly, rolesOf } from '@/lib/data';
import type { Context } from '@/lib/types';
import type { CueSubmission } from '@/lib/cue';
import type { ClaimTpa, TpaMemberRow, TpaNote, TpaRow } from '@/lib/tpa';

export type Side = 'driver' | 'fleet' | 'insurer' | 'tpa';
// Which view of claims the person gets. Insurer staff and platform administrators see claims that have been sent to them.
export const claimSide = (ctx: Context): Side | null =>
  ctx.demo ? 'insurer' : isDriverOnly(ctx) ? 'driver' : rolesOf(ctx).some(r => ['platform_super_admin', 'insurer_admin', 'insurer_claims'].includes(r)) ? 'insurer'
    : rolesOf(ctx).some(r => ['fleet_admin', 'fleet_manager'].includes(r)) ? 'fleet' : isTpaOnly(ctx) ? 'tpa' : null;
export const canReportClaims = (ctx: Context) => { const s = claimSide(ctx); return !ctx.demo && (s === 'driver' || s === 'fleet'); };
export const canLogClaims = (ctx: Context) => !ctx.demo && claimSide(ctx) === 'insurer';
export const claimFleetOf = (ctx: Context) => ctx.memberships.find(m => m.active && ['fleet_admin', 'fleet_manager', 'driver'].includes(m.role))?.organisation_id ?? null;
export { isInsurerSide };

export type ClaimRow = {
  id: string; reference: string; fleet_id: string; insurer_id: string; policy_id: string | null; vehicle_id: string | null; registration: string;
  driver_user_id: string | null; driver_name: string | null; origin: 'driver' | 'fleet' | 'insurer'; reported_by: string; status: string;
  incident_at: string; location: string; description: string; anyone_injured: boolean; injury_details: string | null;
  police_attended: boolean | null; police_reference: string | null; vehicle_driveable: boolean | null; third_party_involved: boolean | null;
  on_cover_at_incident: boolean | null; no_photos_confirmed: boolean; assessed_at: string | null; assessment_notes: string | null;
  submitted_at: string | null; insurer_reference: string | null; closed_at: string | null; outcome: string | null; outcome_note: string | null;
  created_at: string; updated_at: string;
  handler_id?: string | null; handler_email?: string | null; assigned_at?: string | null; first_touched_at?: string | null;
  // Embedded from claim_handling, which only the insurer side can read (it is null for everyone else). Flattened by withHandling().
  claim_handling?: { handler_id: string | null; handler_email: string | null; assigned_at: string | null; first_touched_at: string | null } | null;
};
const HANDLING = 'claim_handling(handler_id,handler_email,assigned_at,first_touched_at)';
function withHandling(row: ClaimRow): ClaimRow {
  const { claim_handling: h, ...rest } = row;
  return { ...rest, handler_id: h?.handler_id ?? null, handler_email: h?.handler_email ?? null, assigned_at: h?.assigned_at ?? null, first_touched_at: h?.first_touched_at ?? null };
}
export type ClaimParty = { id: string; claim_id: string; kind: 'third_party' | 'witness'; name: string; phone: string | null; vehicle_registration: string | null; insurer_name: string | null; injured: boolean | null; notes: string | null; added_by: string };
export type ClaimEvent = { id: string; kind: string; side: 'driver' | 'fleet' | 'insurer'; visibility: string; actor_label: string | null; actor_email: string | null; body: string | null; created_at: string };
export type ClaimRequest = { id: string; claim_id?: string; question: string; due_on: string | null; requested_at: string; answered_at: string | null; answer: string | null; cancelled_at: string | null; last_reminded_at?: string | null; reminder_count?: number };
export type ClaimFile = { id: string; request_id: string | null; kind: 'photo' | 'document'; file_name: string; content_type: string; size_bytes: number; caption: string | null; uploaded_by: string; uploaded_side: Exclude<Side, 'tpa'>; uploaded_at: string };
export type Notice = { id: string; claim_id: string | null; kind: string; title: string; body: string | null; created_at: string; read_at: string | null };

const clean = (q: string) => q.replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 30);

export async function listClaims(p: { status?: string; q?: string; offset: number; limit: number }) {
  const query = new URLSearchParams({ select: '*', order: 'updated_at.desc', offset: String(p.offset), limit: String(p.limit) });
  if (p.status === 'open') query.set('status', 'neq.closed');
  else if (p.status === 'closed') query.set('status', 'eq.closed');
  else if (p.status && p.status.startsWith('in:')) query.set('status', 'in.(' + p.status.slice(3).split(',').filter(s => /^[a-z_]+$/.test(s)).join(',') + ')');
  const q = clean(p.q ?? '');
  if (q) query.set('or', `(reference.ilike.*${q}*,registration.ilike.*${q.replace(/ /g, '')}*)`);
  return rest<{ rows: ClaimRow[]; total: number }>('/rest/v1/claims?' + query, { count: true });
}

export async function countClaims(filter: string) {
  const res = await rest<{ rows: unknown[]; total: number }>(`/rest/v1/claims?select=id&limit=1&${filter}`, { count: true });
  return res.total;
}

export async function getClaim(id: string) {
  const c = checkedId(id);
  const [claims, parties, events, requests, files, items] = await Promise.all([
    rest<ClaimRow[]>('/rest/v1/claims?select=*,' + HANDLING + '&id=eq.' + c),
    rest<ClaimParty[]>(`/rest/v1/claim_parties?select=*&claim_id=eq.${c}&order=created_at.asc&limit=50`),
    rest<ClaimEvent[]>(`/rest/v1/claim_events?select=id,kind,side,visibility,actor_label,actor_email,body,created_at&claim_id=eq.${c}&order=created_at.asc&limit=500`),
    rest<ClaimRequest[]>(`/rest/v1/claim_requests?select=id,question,due_on,requested_at,answered_at,answer,cancelled_at,last_reminded_at,reminder_count&claim_id=eq.${c}&order=requested_at.asc&limit=100`),
    rest<ClaimFile[]>(`/rest/v1/claim_attachments?select=id,request_id,kind,file_name,content_type,size_bytes,caption,uploaded_by,uploaded_side,uploaded_at&claim_id=eq.${c}&order=uploaded_at.asc&limit=100`),
    rest<RequestItem[]>(`/rest/v1/claim_request_items?select=id,request_id,kind,label,created_at,fulfilled_at,attachment_id,unavailable_reason&claim_id=eq.${c}&order=created_at.asc&limit=100`)
  ]);
  return claims[0] ? { claim: withHandling(claims[0]), parties, events, requests, files, items } : null;
}
// When the portal recorded the cover that applied at the time of the incident. A vehicle added after the incident is flagged
// to the people reading the claim. This is information from the portal's own records, not a decision about cover.
export type CoverRecord = { startedAt: string; recordedAt: string; after: boolean } | { startedAt: null; recordedAt: string; after: true } | null;
export async function getCoverRecord(vehicleId: string | null, incidentAt: string): Promise<CoverRecord> {
  if (!vehicleId) return null;
  const rows = await rest<{ cover_start: string; cover_end: string | null; created_at: string; first_recorded_at: string | null }[]>('/rest/v1/coverage_periods?' + new URLSearchParams({
    select: 'cover_start,cover_end,created_at,first_recorded_at', vehicle_id: 'eq.' + checkedId(vehicleId), voided_at: 'is.null', order: 'cover_start.asc', limit: '50' }));
  const at = Date.parse(incidentAt);
  const inForce = rows.find(r => Date.parse(r.cover_start) <= at && (!r.cover_end || Date.parse(r.cover_end) > at));
  if (inForce) return { startedAt: inForce.cover_start, recordedAt: inForce.first_recorded_at ?? inForce.created_at, after: Date.parse(inForce.first_recorded_at ?? inForce.created_at) > at };
  const later = rows.find(r => Date.parse(r.cover_start) > at);
  return later ? { startedAt: null, recordedAt: later.first_recorded_at ?? later.created_at, after: true } : null;
}
// CUE records for a claim, newest first. Row-level security returns rows only to the insurer side.
export async function getCueSubmissions(claimId: string) {
  return rest<CueSubmission[]>(`/rest/v1/cue_submissions?select=id,claim_id,version,submission_status,status_detail,external_reference,created_at&claim_id=eq.${checkedId(claimId)}&order=version.desc&limit=50`);
}
export async function getCueRecord(id: string) {
  const rows = await rest<(CueSubmission & { payload: unknown; claim_reference?: string })[]>(`/rest/v1/cue_submissions?select=id,claim_id,version,submission_status,status_detail,external_reference,created_at,payload&id=eq.${checkedId(id)}`);
  return rows[0] ?? null;
}
export async function getClaimBasic(id: string) {
  const rows = await rest<Pick<ClaimRow, 'id' | 'fleet_id' | 'status'>[]>('/rest/v1/claims?select=id,fleet_id,status&id=eq.' + checkedId(id));
  return rows[0] ?? null;
}
export async function getClaimFile(id: string) {
  const rows = await rest<{ id: string; storage_path: string; file_name: string; content_type: string }[]>(
    '/rest/v1/claim_attachments?select=id,storage_path,file_name,content_type&id=eq.' + checkedId(id));
  return rows[0] ?? null;
}

export async function getNotices(limit = 15) {
  return rest<Notice[]>('/rest/v1/my_notifications?select=*&order=created_at.desc&limit=' + limit);
}

// Choices for the report form.
export async function reportChoices(ctx: Context) {
  const side = claimSide(ctx);
  if (side === 'driver') {
    const rows = await getMyCover();
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.registration, r.make_model || '');
    return { vehicles: [...seen.keys()], drivers: [] as { id: string; name: string }[] };
  }
  const fleet = claimFleetOf(ctx);
  if (side !== 'fleet' || !fleet) return { vehicles: [] as string[], drivers: [] as { id: string; name: string }[] };
  const [veh, drv] = await Promise.all([
    rest<{ registration: string }[]>(`/rest/v1/vehicles?select=registration&fleet_id=eq.${checkedId(fleet)}&order=registration.asc&limit=500`),
    rest<{ user_id: string; full_name: string }[]>(`/rest/v1/driver_profiles?select=user_id,full_name&fleet_id=eq.${checkedId(fleet)}&order=full_name.asc&limit=300`)
  ]);
  return { vehicles: veh.map(v => v.registration), drivers: drv.map(d => ({ id: d.user_id, name: d.full_name })) };
}

// A typed registration to a vehicle in the fleet, if there is one.
export async function vehicleIdByRegistration(fleet: string, registration: string): Promise<string | null> {
  const rows = await rest<{ id: string }[]>(`/rest/v1/vehicles?select=id&fleet_id=eq.${checkedId(fleet)}&registration=eq.${encodeURIComponent(registration)}&limit=1`);
  return rows[0]?.id ?? null;
}
export async function myVehicleIdByRegistration(registration: string): Promise<string | null> {
  const rows = await getMyCover();
  return rows.find(r => r.registration === registration)?.vehicle_id ?? null;
}

export async function unreadCount(): Promise<number> {
  try { return (await rest<{ rows: unknown[]; total: number }>('/rest/v1/my_notifications?select=id&read_at=is.null&limit=1', { count: true })).total; }
  catch { return 0; }
}

export type ClaimHandler = { user_id: string; email: string; role: string };

function toInbox(row: ClaimRow, request: ClaimRequest | null, coverAfter: boolean): import('@/lib/inbox').InboxClaim {
  return {
    id: row.id, reference: row.reference, fleet_id: row.fleet_id, registration: row.registration,
    driver_name: row.driver_name, status: row.status, anyone_injured: row.anyone_injured, incident_at: row.incident_at,
    submitted_at: row.submitted_at, updated_at: row.updated_at,
    handler_id: row.handler_id ?? null, handler_email: row.handler_email ?? null,
    assigned_at: row.assigned_at ?? null, first_touched_at: row.first_touched_at ?? null,
    cover_after: coverAfter, open_request: request ? { id: request.id, due_on: request.due_on, requested_at: request.requested_at } : null
  };
}

export async function listInboxClaims() {
  const rows = (await rest<ClaimRow[]>('/rest/v1/claims?select=*,' + HANDLING + '&status=neq.closed&submitted_at=not.is.null&order=updated_at.desc&limit=500')).map(withHandling);
  if (!rows.length) return [];
  const ids = rows.map(r => checkedId(r.id)).join(',');
  const requests = await rest<ClaimRequest[]>(`/rest/v1/claim_requests?select=id,claim_id,question,due_on,requested_at,answered_at,cancelled_at&answered_at=is.null&cancelled_at=is.null&claim_id=in.(${ids})&limit=500`).catch(() => []);
  return rows.map(r => toInbox(r, requests.find(q => q.claim_id === r.id && !q.answered_at && !q.cancelled_at) ?? null, r.on_cover_at_incident === false));
}

export function inboxFromClaim(row: ClaimRow, requests: ClaimRequest[], coverAfter: boolean) {
  const open = requests.find(r => !r.answered_at && !r.cancelled_at) ?? null;
  return toInbox(row, open, coverAfter);
}

export async function listClaimHandlers(claimId: string): Promise<ClaimHandler[]> {
  try { return await rpc<ClaimHandler[]>('list_claim_handlers', { p_claim: checkedId(claimId) }); }
  catch { return []; }
}

export type SavedReply = { id: string; title: string; body: string };
export type PossibleDuplicate = { id: string; reference: string; incident_at: string; status: string; location: string };
export async function getSavedReplies(insurerId: string): Promise<SavedReply[]> {
  return rest<SavedReply[]>(`/rest/v1/saved_replies?select=id,title,body&insurer_id=eq.${checkedId(insurerId)}&order=created_at.asc&limit=30`).catch(() => []);
}
export async function getPossibleDuplicates(claimId: string): Promise<PossibleDuplicate[]> {
  try { return await rpc<PossibleDuplicate[]>('claim_possible_duplicates', { p_claim: checkedId(claimId) }); } catch { return []; }
}
// The digest is on unless the person has opted out. Only their own row is readable.
export async function digestOn(): Promise<boolean> {
  try { return (await rest<{ user_id: string }[]>('/rest/v1/digest_optout?select=user_id&limit=1')).length === 0; } catch { return true; }
}

// ---- third-party administrators. Row-level security shows these only to the insurer and to the TPA the claim is routed to.
export async function getClaimTpa(claimId: string): Promise<{ routing: ClaimTpa | null; notes: TpaNote[] }> {
  const c = checkedId(claimId);
  try {
    const [routing, notes] = await Promise.all([
      rest<ClaimTpa[]>(`/rest/v1/claim_tpa?select=claim_id,tpa_id,assigned_at,first_touched_at,recommendation,recommendation_note,recommended_at,tpas(name)&claim_id=eq.${c}`),
      rest<TpaNote[]>(`/rest/v1/claim_tpa_notes?select=id,side,author_email,body,created_at&claim_id=eq.${c}&order=created_at.asc&limit=300`)
    ]);
    return { routing: routing[0] ?? null, notes };
  } catch { return { routing: null, notes: [] }; }
}
export async function listTpas(insurerId?: string): Promise<TpaRow[]> {
  const filter = insurerId ? '&insurer_id=eq.' + checkedId(insurerId) : '';
  return rest<TpaRow[]>('/rest/v1/tpas?select=id,name,active,insurer_id&order=name.asc&limit=200' + filter).catch(() => []);
}
export async function listTpaMembers(tpaId: string): Promise<TpaMemberRow[]> {
  try { return await rpc<TpaMemberRow[]>('list_tpa_members', { p_tpa: checkedId(tpaId) }); } catch { return []; }
}
