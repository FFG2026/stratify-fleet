import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, getDashboard, demoSummary, isInsurerSide, rolesOf } from '@/lib/data';
import { PageHeader, LinkButton, Notice } from '@/components/ui';
import { LiveDashboard, StaticDashboard } from '@/components/Dashboards';
import { RestError } from '@/lib/rest';

export default async function Insurer({ searchParams }: { searchParams: Promise<{ insurer?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const { insurer = '' } = await searchParams;
  const header = (
    <PageHeader title="Insurer dashboard" subtitle="Confidence across every fleet in your book."
      actions={<><LinkButton href="/fleet">View vehicle register</LinkButton><LinkButton href="/reconciliation" primary>Review reconciliation →</LinkButton></>} />
  );
  if (!isInsurerSide(ctx)) return (<>{header}<section className="panel"><div className="panel-body"><h2>Insurer dashboard access</h2><p>This dashboard requires insurer or platform administrator membership. Your current account has not been assigned this access.</p><Link prefetch={false} className="button-link" href="/customer">Open your fleet dashboard →</Link></div></section></>);
  if (ctx.demo) return (<>{header}<StaticDashboard ctx={ctx} summary={demoSummary()} showOrgNote={false} /></>);
  try {
    const data = await getDashboard(insurer || undefined);
    return (<>{header}<LiveDashboard ctx={ctx} data={data} insurerFilter={insurer} showInsurerPicker={rolesOf(ctx).includes('platform_super_admin')} /></>);
  } catch (e) { return (<>{header}<Notice alert>{e instanceof RestError ? e.message : e instanceof Error ? e.message : 'Unable to load the live figures.'}</Notice></>); }
}
