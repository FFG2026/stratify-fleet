// One vehicle for the insurer (and fleet) view: its cover history and who has driven it. Reads as the signed-in person, so row-level
// security decides what comes back; roles that cannot read driver names still see that the vehicle was assigned and the dates.
import { rest } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { londonDate } from '@/lib/dates';
import { normalisePeriod } from '@/lib/data';
import type { Period } from '@/lib/types';

export type VehicleRow = { id: string; fleet_id: string; registration: string; make_model: string | null };
export type AssignmentRow = { id: string; user_id: string; assigned_from: string; assigned_to: string | null };
export type DriverStint = { id: string; user_id: string; name: string | null; from: string; to: string | null; status: 'current' | 'upcoming' | 'previous' };

// Newest first. "current" means the stint covers today; a stint ending today still counts as current.
export function shapeStints(rows: AssignmentRow[], names: Map<string, string>, today: string): DriverStint[] {
  return rows
    .map(a => ({
      id: a.id, user_id: a.user_id, name: names.get(a.user_id) ?? null, from: a.assigned_from, to: a.assigned_to,
      status: (a.assigned_from > today ? 'upcoming' : a.assigned_to && a.assigned_to < today ? 'previous' : 'current') as DriverStint['status']
    }))
    .sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));
}

export const ukDate = (d: string | null | undefined) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '');

export async function vehicleDetail(id: string) {
  const vid = checkedId(id);
  const vehicles = await rest<VehicleRow[]>('/rest/v1/vehicles?select=id,fleet_id,registration,make_model&id=eq.' + vid);
  const vehicle = vehicles[0];
  if (!vehicle) return null;
  const [periodRows, assignments] = await Promise.all([
    rest<Parameters<typeof normalisePeriod>[0][]>('/rest/v1/coverage_periods?select=*,vehicle:vehicles!inner(registration,make_model)&vehicle_id=eq.' + vid + '&voided_at=is.null&order=cover_start.desc,id.desc&limit=50'),
    rest<AssignmentRow[]>('/rest/v1/vehicle_assignments?select=id,user_id,assigned_from,assigned_to&vehicle_id=eq.' + vid + '&order=assigned_from.desc&limit=200')
  ]);
  let names = new Map<string, string>();
  if (assignments.length) {
    try {
      const ids = [...new Set(assignments.map(a => checkedId(a.user_id)))];
      const profiles = await rest<{ user_id: string; full_name: string }[]>('/rest/v1/driver_profiles?select=user_id,full_name&user_id=in.(' + ids.join(',') + ')&limit=500');
      names = new Map(profiles.map(p => [p.user_id, p.full_name]));
    } catch { /* this role cannot read driver names */ }
  }
  const periods: Period[] = periodRows.map(normalisePeriod);
  return { vehicle, periods, stints: shapeStints(assignments, names, londonDate(new Date())) };
}
