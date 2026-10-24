import { redirect } from 'next/navigation';
import { getContext, getSummary, demoSummary, isDriverOnly, getCoveredVehicles } from '@/lib/data';
import { PageHeader, LinkButton } from '@/components/ui';
import { StaticDashboard } from '@/components/Dashboards';

export default async function Customer() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx)) redirect('/driver');
  const summary = ctx.demo ? demoSummary() : await getSummary(ctx);
  let unassigned: { covered: number; without: number } | null = null;
  if (!ctx.demo) { try { const v = await getCoveredVehicles(ctx); unassigned = { covered: v.length, without: v.filter(x => !x.drivers.length).length }; } catch { unassigned = null; } }
  return (
    <>
      <PageHeader title="Fleet dashboard" subtitle="Your fleet, covered. Every change accounted for."
        actions={<><LinkButton href="/reconciliation">Open reconciliation →</LinkButton><LinkButton href="/changes" primary>＋ Add vehicle</LinkButton></>} />
      <StaticDashboard ctx={ctx} summary={summary} showOrgNote={false} fleetView unassigned={unassigned} />
    </>
  );
}
