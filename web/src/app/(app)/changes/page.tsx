import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, canChange, getCoverActivity, orgName, isDriverOnly } from '@/lib/data';
import { PageHeader, LinkButton, Badge, Notice } from '@/components/ui';
import { AddVehicleForm, RemoveVehicleForm } from '@/components/CoverForms';
import { londonDateTime, today } from '@/lib/dates';
import { demoEvents } from '@/lib/demo';

type SP = { mode?: string; policy?: string; rq?: string };

export default async function Changes({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx)) redirect('/driver');
  const sp = await searchParams;
  const mode = sp.mode === 'remove' ? 'remove' : 'add';
  const allowed = canChange(ctx);
  const t = today();
  let error = '';
  let audit: { id: string | number; registration: string; action: string; created_at: string }[] = demoEvents;
  if (!ctx.demo) {
    try { audit = await getCoverActivity(5); } catch { audit = []; }
  }
  const tab = (m: string, label: string) => {
    const q = new URLSearchParams(); q.set('mode', m); if (sp.policy) q.set('policy', sp.policy);
    return <Link prefetch={false} role="tab" href={'?' + q} className={mode === m ? 'active' : ''} aria-selected={mode === m}>{label}</Link>;
  };
  return (
    <>
      <PageHeader title="Manage cover" subtitle="Precise effective dates. A permanent record of every change." actions={<LinkButton href="/fleet">← Vehicle register</LinkButton>} />
      <div className="tabs" role="tablist" aria-label="Coverage change">{tab('add', '＋ Add vehicle')}{tab('remove', '− Remove vehicle')}</div>
      <Notice>Development rules: coverage starts on the addition date and ends before the removal date. Same-day removal and backdated changes require an approval process and are currently blocked. No MID submissions are sent.</Notice>
      {error && <Notice alert>{error}</Notice>}
      <div className="cover-layout">
        <div>
          {mode === 'add' ? (
            <section className="panel" role="tabpanel">
              <div className="panel-header"><h2>Add vehicle to a policy</h2><Badge>Effective date required</Badge></div>
              <div className="panel-body"><AddVehicleForm today={t} allowed={allowed} policies={ctx.policies.map(p => ({ id: p.id, label: `${p.reference} · ${orgName(ctx, p.customer_id)}` }))} /></div>
            </section>
          ) : (
            <section className="panel" role="tabpanel">
              <div className="panel-header"><h2>Remove a vehicle</h2></div>
              <div className="panel-body">
                <RemoveVehicleForm today={t} allowed={allowed} policyId={sp.policy} initialQuery={sp.rq ?? ''} />
              </div>
            </section>
          )}
        </div>
        <div className="panel">
          <div className="panel-header"><h2>Coverage activity</h2></div>
          <div className="panel-body"><div className="timeline">
            {audit.slice(0, 5).map(e => <div className="event" key={e.id}><strong>{e.registration}</strong> · {e.action}<p>{londonDateTime(e.created_at)}</p></div>)}
            {!audit.length && <div className="event"><strong>Workspace ready</strong><p>Recorded changes will appear here with their effective dates and audit history.</p></div>}
          </div></div>
        </div>
      </div>
    </>
  );
}
