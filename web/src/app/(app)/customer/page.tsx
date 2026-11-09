import { redirect } from 'next/navigation';
import { getContext, getSummary, demoSummary, isDriverOnly, isInsurerOnly, getCoveredVehicles } from '@/lib/data';
import { PageHeader, LinkButton } from '@/components/ui';
import { StaticDashboard } from '@/components/Dashboards';
import { rpc } from '@/lib/rest';
import { gbp } from '@/lib/bordereau';
import type { PriceRow } from '@/lib/burn';

export default async function Customer() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx)) redirect('/driver');
  if (isInsurerOnly(ctx)) redirect('/insurer');
  const summary = ctx.demo ? demoSummary() : await getSummary(ctx);
  let unassigned: { covered: number; without: number } | null = null;
  if (!ctx.demo) { try { const v = await getCoveredVehicles(ctx); unassigned = { covered: v.length, without: v.filter(x => !x.drivers.length).length }; } catch { unassigned = null; } }
  let prices: { policy: string; row: PriceRow }[] = [];
  if (!ctx.demo) {
    const mine = ctx.orgs.filter(o => o.kind === 'customer' && ctx.memberships.some(m => m.active && m.organisation_id === o.id));
    for (const o of mine.slice(0, 5)) { try { for (const row of await rpc<PriceRow[]>('fleet_policy_prices', { p_fleet: o.id })) prices.push({ policy: row.policy_number, row }); } catch { /* not allowed or no rate */ } }
  }
  return (
    <>
      <PageHeader title="Fleet dashboard" subtitle="Your fleet, covered. Every change accounted for."
        actions={<><LinkButton href="/reconciliation">Open reconciliation →</LinkButton><LinkButton href="/changes" primary>＋ Add vehicle</LinkButton></>} />
      {prices.length > 0 && (
        <div className="stats">{prices.map(p => (
          <div className="stat" key={p.row.policy_id}><div className="stat-label">Your price per vehicle</div><div className="stat-number">{gbp(p.row.monthly_price)} <span style={{ fontSize: '0.9rem' }}>a month</span></div>
            <div className="stat-note">{gbp(p.row.daily_rate)} a day, excl. IPT · policy {p.policy}</div></div>
        ))}</div>
      )}
      <StaticDashboard ctx={ctx} summary={summary} showOrgNote={false} fleetView unassigned={unassigned} />
    </>
  );
}
