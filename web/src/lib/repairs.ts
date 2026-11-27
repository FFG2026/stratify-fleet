import { rest, rpc } from '@/lib/rest';
import { checkedId } from '@/lib/ids';

// Repair shops. Labels and shapes only; every decision about who may see or do what is made in the database.
export type RepairStatus = 'with_repairer' | 'quote_submitted' | 'approved' | 'completed';
export const repairStatusLabel: Record<RepairStatus, string> = {
  with_repairer: 'With the repair shop', quote_submitted: 'Quote waiting for approval', approved: 'Repair approved', completed: 'Repair complete'
};
export const repairStatusHint: Record<RepairStatus, string> = {
  with_repairer: 'The shop is adding photos and a quote.',
  quote_submitted: 'The insurer is reviewing the quote.',
  approved: 'The insurer has approved the repair. The shop can go ahead.',
  completed: 'The repair is finished.'
};
export const isRepairStatus = (v: unknown): v is RepairStatus => typeof v === 'string' && v in repairStatusLabel;
export const repairIsOpen = (s: string) => s !== 'completed';

export type RepairFileKind = 'photo' | 'quote' | 'invoice';
export const repairFileKindLabel: Record<RepairFileKind, string> = { photo: 'Photo', quote: 'Quote', invoice: 'Invoice' };

export type RepairRow = {
  claim_id: string; repairer_id: string; status: RepairStatus; quote_amount: number | string | null; quote_note: string | null;
  quote_submitted_at: string | null; decided_at: string | null; completed_at: string | null; assigned_at: string; updated_at: string;
  repairers?: { name: string } | null;
};
export type RepairFile = { id: string; kind: RepairFileKind; file_name: string; content_type: string; size_bytes: number; caption: string | null; uploaded_at: string };
export type RepairNote = { id: string; side: 'repairer' | 'insurer'; author_email: string | null; body: string; created_at: string };
export type RepairerRow = { id: string; name: string; active: boolean; insurer_id: string };
export type RepairerMemberRow = { id: string; email: string; active: boolean; created_at: string };
export type RepairerClaim = {
  claim_id: string; reference: string; registration: string; make_model: string | null; incident_at: string; location: string; description: string;
  vehicle_driveable: boolean | null; fleet_name: string; repair_status: RepairStatus; quote_amount: number | string | null; quote_note: string | null;
  assigned_at: string; updated_at: string; repairer_name: string;
};

/** Parse a quote total typed by the shop. Returns null when it is not a usable amount. */
export function parseQuoteAmount(v: unknown): number | null {
  const t = String(v ?? '').replace(/[£,\s]/g, '');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 10000000 ? n : null;
}

/** What the shop can still do at each stage. Mirrors the database rules so the page only offers what will work. */
export function repairActions(status: RepairStatus) {
  return {
    addPhotos: status !== 'completed',
    addQuote: status === 'with_repairer',
    submitQuote: status === 'with_repairer',
    addInvoice: status === 'approved',
    complete: status === 'approved',
    insurerDecide: status === 'quote_submitted',
    insurerCanTakeBack: status === 'with_repairer' || status === 'quote_submitted'
  };
}

// ---- reads (as the signed-in person; the database decides what comes back)
export async function getRepair(claimId: string) {
  const id = checkedId(claimId);
  const rows = await rest<RepairRow[]>('/rest/v1/claim_repair?select=*,repairers(name)&claim_id=eq.' + id).catch(() => []);
  const repair = rows[0] ?? null;
  if (!repair) return null;
  const [files, notes] = await Promise.all([
    rest<RepairFile[]>('/rest/v1/repair_files?select=id,kind,file_name,content_type,size_bytes,caption,uploaded_at&claim_id=eq.' + id + '&order=uploaded_at.asc&limit=100').catch(() => []),
    rest<RepairNote[]>('/rest/v1/claim_repair_notes?select=id,side,author_email,body,created_at&claim_id=eq.' + id + '&order=created_at.asc&limit=200').catch(() => [])
  ]);
  return { repair, files, notes };
}
export async function getRepairFile(id: string) {
  const rows = await rest<{ id: string; storage_path: string; file_name: string; content_type: string }[]>(
    '/rest/v1/repair_files?select=id,storage_path,file_name,content_type&id=eq.' + checkedId(id));
  return rows[0] ?? null;
}
export async function listRepairers(insurerId?: string): Promise<RepairerRow[]> {
  const filter = insurerId ? '&insurer_id=eq.' + checkedId(insurerId) : '';
  return rest<RepairerRow[]>('/rest/v1/repairers?select=id,name,active,insurer_id&order=name.asc&limit=200' + filter).catch(() => []);
}
export async function listRepairerMembers(id: string): Promise<RepairerMemberRow[]> {
  try { return await rpc<RepairerMemberRow[]>('list_repairer_members', { p_repairer: checkedId(id) }); } catch { return []; }
}
export async function myRepairs(claimId?: string): Promise<RepairerClaim[]> {
  try { return await rpc<RepairerClaim[]>('repairer_claims', { p_claim: claimId ? checkedId(claimId) : null }); } catch { return []; }
}
