import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, getDashboard, demoSummary, isPlatform } from '@/lib/data';
import { PageHeader, LinkButton, Notice } from '@/components/ui';
import { LiveDashboard, StaticDashboard } from '@/components/Dashboards';
import { RestError } from '@/lib/rest';

export default async function Overview() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const header = (
    <PageHeader crumb="PLATFORM CONTROL" title="A clear view of your entire portfolio." subtitle="Your insurers, customers and operations. In one place."
      actions={<><LinkButton href="/insurer">Open insurer workspace →</LinkButton><LinkButton href="/reconciliation" primary>Review reconciliation →</LinkButton></>} />
  );
  if (!isPlatform(ctx)) return (<>{header}<section className="panel"><div className="panel-body"><h2>Platform overview access</h2><p>This dashboard requires platform administrator membership. Your current account has not been assigned this access.</p><Link className="button-link" href="/customer">Open your fleet dashboard →</Link></div></section></>);
  if (ctx.demo) return (<>{header}<StaticDashboard ctx={ctx} summary={demoSummary()} showOrgNote /></>);
  try {
    return (<>{header}<LiveDashboard ctx={ctx} data={await getDashboard()} insurerFilter="" showInsurerPicker={false} /></>);
  } catch (e) { return (<>{header}<Notice alert>{e instanceof RestError ? e.message : 'Unable to load the live figures.'}</Notice></>); }
}
