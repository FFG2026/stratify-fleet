import 'server-only';
import { rest, rpc } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { rolesOf } from '@/lib/data';
import type { Context } from '@/lib/types';
import { riskScore, weightedPoints, type EventKind } from '@/lib/telematics';

export type TelematicsView = 'fleet' | 'insurer';
// Fleet admins, fleet managers and platform administrators see driver-level records. Insurer staff see vehicle-level totals only.
export const telematicsView = (ctx: Context): TelematicsView | null =>
  ctx.demo ? null : rolesOf(ctx).some(r => ['platform_super_admin', 'fleet_admin', 'fleet_manager'].includes(r)) ? 'fleet'
    : rolesOf(ctx).some(r => ['insurer_admin', 'insurer_claims'].includes(r)) ? 'insurer' : null;

export type TelEvent = { id: string; vehicle_id: string; driver_id: string | null; occurred_at: string; kind: EventKind; severity: number; speed_mph: number | null; limit_mph: number | null; location: string | null; source: string };
export type TelTrip = { vehicle_id: string; driver_id: string | null; started_at: string; distance_miles: number };
export type Totals = { registration: string; miles: number; harsh_braking: number; harsh_acceleration: number; harsh_cornering: number; speeding: number; crash_alerts: number; weighted_points: number; score: number | null };
export type DriverTotals = { driver_id: string | null; name: string; miles: number; events: number; points: number; score: number | null };

const sinceIso = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

export async function getFleetTelematics(fleetId: string, days: number) {
  const id = checkedId(fleetId); const since = encodeURIComponent(sinceIso(days));
  const [events, trips, vehicles] = await Promise.all([
    rest<TelEvent[]>(`/rest/v1/telematics_events?select=id,vehicle_id,driver_id,occurred_at,kind,severity,speed_mph,limit_mph,location,source&fleet_id=eq.${id}&occurred_at=gte.${since}&order=occurred_at.desc&limit=5000`),
    rest<TelTrip[]>(`/rest/v1/telematics_trips?select=vehicle_id,driver_id,started_at,distance_miles&fleet_id=eq.${id}&started_at=gte.${since}&limit=5000`),
    rest<{ id: string; registration: string }[]>(`/rest/v1/vehicles?select=id,registration&fleet_id=eq.${id}&limit=5000`)
  ]);
  const reg = new Map(vehicles.map(v => [v.id, v.registration]));
  const ids = [...new Set([...events, ...trips].map(r => r.driver_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const profiles = await rest<{ user_id: string; full_name: string }[]>(`/rest/v1/driver_profiles?select=user_id,full_name&user_id=in.(${ids.map(checkedId).join(',')})&limit=5000`);
    for (const p of profiles) names.set(p.user_id, p.full_name);
  }
  const vehicleTotals = new Map<string, Totals>();
  const row = (vid: string): Totals => {
    let t = vehicleTotals.get(vid);
    if (!t) { t = { registration: reg.get(vid) ?? 'Unknown', miles: 0, harsh_braking: 0, harsh_acceleration: 0, harsh_cornering: 0, speeding: 0, crash_alerts: 0, weighted_points: 0, score: null }; vehicleTotals.set(vid, t); }
    return t;
  };
  for (const t of trips) row(t.vehicle_id).miles += Number(t.distance_miles);
  for (const e of events) { const t = row(e.vehicle_id); if (e.kind === 'crash_alert') t.crash_alerts++; else t[e.kind]++; }
  const perVehicle = [...vehicleTotals.entries()].map(([vid, t]) => {
    t.weighted_points = weightedPoints(events.filter(e => e.vehicle_id === vid)); t.score = riskScore(t.weighted_points, t.miles); return t;
  });
  const drivers = new Map<string, DriverTotals>();
  const d = (id: string | null): DriverTotals => {
    const k = id ?? 'none'; let t = drivers.get(k);
    if (!t) { t = { driver_id: id, name: id ? names.get(id) ?? 'Driver' : 'No driver assigned', miles: 0, events: 0, points: 0, score: null }; drivers.set(k, t); }
    return t;
  };
  for (const t of trips) d(t.driver_id).miles += Number(t.distance_miles);
  for (const e of events) { const t = d(e.driver_id); if (e.kind !== 'crash_alert') t.events++; t.points += weightedPoints([e]); }
  const perDriver = [...drivers.values()].map(t => ({ ...t, score: t.driver_id ? riskScore(t.points, t.miles) : null }));
  return { perVehicle, perDriver, crashes: events.filter(e => e.kind === 'crash_alert').map(e => ({ ...e, registration: reg.get(e.vehicle_id) ?? 'Unknown', driver: e.driver_id ? names.get(e.driver_id) ?? 'Driver' : null })), recent: events.filter(e => e.kind !== 'crash_alert').slice(0, 25).map(e => ({ ...e, registration: reg.get(e.vehicle_id) ?? 'Unknown', driver: e.driver_id ? names.get(e.driver_id) ?? 'Driver' : null })), eventCount: events.length, tripCount: trips.length };
}

export async function getInsurerTelematics(fleetId: string, days: number) {
  const rows = await rpc<(Omit<Totals, 'score'> & { miles: number | string })[]>('telematics_vehicle_totals', { p_fleet: checkedId(fleetId), p_days: days });
  return rows.map(r => ({ ...r, miles: Number(r.miles), harsh_braking: Number(r.harsh_braking), harsh_acceleration: Number(r.harsh_acceleration), harsh_cornering: Number(r.harsh_cornering),
    speeding: Number(r.speeding), crash_alerts: Number(r.crash_alerts), weighted_points: Number(r.weighted_points), score: riskScore(Number(r.weighted_points), Number(r.miles)) }));
}
