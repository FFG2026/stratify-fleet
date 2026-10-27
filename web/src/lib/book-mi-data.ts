import 'server-only';
import { rest } from '@/lib/rest';
import { getCoveredVehicles } from '@/lib/data';
import type { Context, FleetOverviewRow } from '@/lib/types';
import { today } from '@/lib/dates';
import { checkedId } from '@/lib/ids';
import { medianMs, type BookFleetRow } from '@/lib/book-mi';
import { demoBookRows, demoMedianFirstTouchMs } from '@/lib/demo-inbox';

type ClaimHit = { fleet_id: string; status: string; submitted_at: string | null; on_cover_at_incident: boolean | null; claim_handling: { first_touched_at: string | null } | null };
type Locked = { fleet_id: string; premium_gross: string | null; month_start: string };
type Check = { user_id: string; fleet_id: string; next_check_due: string | null; checked_at: string };

export async function getBookMi(ctx: Context, fleets: FleetOverviewRow[]): Promise<{ rows: BookFleetRow[]; medianFirstTouchMs: number | null }> {
  if (ctx.demo) return { rows: demoBookRows, medianFirstTouchMs: demoMedianFirstTouchMs };
  if (!fleets.length) return { rows: [], medianFirstTouchMs: null };
  const yearAgo = new Date(); yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const ids = fleets.map(f => checkedId(f.fleet_id));
  const scope = 'fleet_id=in.(' + ids.join(',') + ')';
  const [claims, locked, checks, covered] = await Promise.all([
    rest<ClaimHit[]>('/rest/v1/claims?select=fleet_id,status,submitted_at,on_cover_at_incident,claim_handling(first_touched_at)&submitted_at=not.is.null&or=(status.neq.closed,submitted_at.gte.' + yearAgo.toISOString() + ')&' + scope + '&limit=2000').catch(() => []),
    rest<Locked[]>('/rest/v1/reconciliations?select=fleet_id,premium_gross,month_start&status=eq.locked&month_start=gte.' + yearStart + '&' + scope + '&limit=500').catch(() => []),
    rest<Check[]>('/rest/v1/licence_checks?select=user_id,fleet_id,next_check_due,checked_at&order=checked_at.desc&' + scope + '&limit=2000').catch(() => []),
    getCoveredVehicles(ctx).catch(() => [])
  ]);
  const latestCheck = new Map<string, Check>();
  for (const c of checks) if (!latestCheck.has(c.user_id)) latestCheck.set(c.user_id, c);
  const due = today();
  const yearAgoMs = yearAgo.getTime();
  const waits = claims.filter(c => c.submitted_at && c.claim_handling?.first_touched_at).map(c => Date.parse(c.claim_handling!.first_touched_at!) - Date.parse(c.submitted_at!)).filter(ms => Number.isFinite(ms) && ms >= 0);
  return {
    rows: fleets.map(f => {
      const mine = claims.filter(c => c.fleet_id === f.fleet_id);
      const earnedRows = locked.filter(r => r.fleet_id === f.fleet_id);
      const vehicles = covered.filter(v => v.fleet_id === f.fleet_id);
      return {
        fleet_id: f.fleet_id,
        fleet_name: f.fleet_name,
        on_cover: Number(f.vehicles_on_cover || 0),
        earned_ytd: earnedRows.length ? earnedRows.reduce((a, r) => a + Number(r.premium_gross || 0), 0) : null,
        claims_12m: mine.filter(c => c.submitted_at && Date.parse(c.submitted_at) >= yearAgoMs).length,
        open: mine.filter(c => c.status !== 'closed').length,
        cover_after: mine.filter(c => c.on_cover_at_incident === false).length,
        licence_overdue: [...latestCheck.values()].filter(c => c.fleet_id === f.fleet_id && c.next_check_due && c.next_check_due < due).length,
        no_driver: vehicles.filter(v => !v.drivers.length).length
      };
    }),
    medianFirstTouchMs: medianMs(waits)
  };
}
