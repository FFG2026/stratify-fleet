import 'server-only';
import { rpc } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { parseDate } from '@/lib/dates';

export type NationalMatch = { user_id: string; full_name: string; birth_year: number | null; date_of_birth: string | null; fleet_name: string | null };
export type NationalRecord = { kind: 'employment' | 'claim' | 'conviction'; title: string; detail: string | null; start_date: string; end_date: string | null; amount: number | null; at_fault: boolean | null; points: number | null };
export type NationalFile = { user_id: string; full_name: string; date_of_birth: string | null; fleet_name: string | null; no_claims_declared_at: string | null; no_convictions_declared_at: string | null; shared_since: string; records: NationalRecord[] };

export const cleanName = (q: string) => q.replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 60);

// Every call is recorded in the audit log by the database function, with who searched and what for.
export async function searchNational(name: string, dob: string): Promise<NationalMatch[]> {
  const n = cleanName(name);
  return rpc<NationalMatch[]>('search_national_drivers', { p_name: n, p_dob: dob ? (parseDate(dob), dob) : null });
}
export const nationalFile = (id: string) => rpc<NationalFile>('national_driver_file', { p_user: checkedId(id) });
