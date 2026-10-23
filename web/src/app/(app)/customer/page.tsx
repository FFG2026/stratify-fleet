import { redirect } from 'next/navigation';
import { getContext, getSummary, demoSummary } from '@/lib/data';
import { PageHeader, LinkButton } from '@/components/ui';
import { StaticDashboard } from '@/components/Dashboards';

export default async function Customer() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const summary = ctx.demo ? demoSummary() : await getSummary(ctx);
  return (
    <>
      <PageHeader title="Fleet dashboard" subtitle="Your fleet, covered. Every change accounted for."
        actions={<><LinkButton href="/reconciliation">Open reconciliation →</LinkButton><LinkButton href="/changes" primary>＋ Add vehicle</LinkButton></>} />
      <StaticDashboard ctx={ctx} summary={summary} showOrgNote={false} />
    </>
  );
}
