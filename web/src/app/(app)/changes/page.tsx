import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, canChange, getFleetPage, orgName } from '@/lib/data';
import { PageHeader, LinkButton, Badge, Notice } from '@/components/ui';
import { AddVehicleForm, RemoveVehicleForm } from '@/components/CoverForms';
import { londonDateTime, today } from '@/lib/dates';
import { rest } from '@/lib/rest';
import { demoEvents } from '@/lib/demo';

type SP = { mode?: string; policy?: string; rq?: string; ro?: string };

export default async function Changes({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const sp = await searchParams;
  const mode = sp.mode === 'remove' ? 'remove' : 'add';
  const allowed = canChange(ctx);
  const t = today();
  const offset = Math.max(0, Number(sp.ro) || 0);
  let removal = { rows: [] as { id: string; registration: string; policy_id: string; starts_on: string }[], total: 0 };
  let error = '';
  if (mode === 'remove' && !ctx.demo) {
    try { const p = await getFleetPage({ q: sp.rq, status: 'open', policy: sp.policy, offset: String(offset), limit: '25' }); removal = { rows: p.rows, total: p.total }; }
    catch (e) { error = e instanceof Error ? e.message : 'Unable to load vehicles.'; }
  }
  let audit: { id: string | number; registration: string; action: string; created_at: string }[] = demoEvents;
  if (!ctx.demo) {
    try {
      const rows = await rest<{ id: number; occurred_at: string; action: string; entity_type: string; before_state: { registration?: string } | null; after_state: { registration?: string } | null }[]>('/rest/v1/audit_logs?select=*&order=occurred_at.desc&limit=5');
      audit = rows.map(a => ({ id: a.id, registration: a.after_state?.registration || a.before_state?.registration || a.entity_type, action: a.action, created_at: a.occurred_at }));
    } catch { audit = []; }
  }
  const tab = (m: string, label: string) => {
    const q = new URLSearchParams(); q.set('mode', m); if (sp.policy) q.set('policy', sp.policy);
    return <Link prefetch={false} role="tab" href={'?' + q} className={mode === m ? 'active' : ''} aria-selected={mode === m}>{label}</Link>;
  };
  const ref = (id: string) => ctx.policies.find(p => p.id === id)?.reference;
  const next = new URLSearchParams(); next.set('mode', 'remove'); if (sp.policy) next.set('policy', sp.policy); if (sp.rq) next.set('rq', sp.rq);
  const nav = (o: number) => { const q = new URLSearchParams(next); q.set('ro', String(o)); return '?' + q; };
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
                <form method="get">
                  <input type="hidden" name="mode" value="remove" />{sp.policy && <input type="hidden" name="policy" value={sp.policy} />}
                  <label>Find a vehicle<input name="rq" type="search" maxLength={80} defaultValue={sp.rq ?? ''} placeholder="Registration or vehicle name" /></label>
                  <button>Search</button>
                </form>
                <p className="form-note">Showing up to 25 open periods. Search to narrow the list.</p>
                <div className="actions">
                  {offset > 0 ? <Link prefetch={false} className="button-link" href={nav(Math.max(0, offset - 25))}>Previous</Link> : <button disabled>Previous</button>}
                  {offset + 25 < removal.total ? <Link prefetch={false} className="button-link" href={nav(offset + 25)}>Next</Link> : <button disabled>Next</button>}
                </div>
                <RemoveVehicleForm today={t} allowed={allowed} periods={removal.rows.map(r => ({ id: r.id, label: `${r.registration} · ${ref(r.policy_id)} · from ${r.starts_on}` }))} />
              </div>
            </section>
          )}
        </div>
        <div className="panel">
          <div className="panel-header"><h2>Coverage activity</h2></div>
          <div className="panel-body"><div className="timeline">
            {audit.slice(0, 5).map(e => <div className="event" key={e.id}><strong>{e.registration}</strong> · {e.action.replaceAll('_', ' ')}<p>{londonDateTime(e.created_at)}</p></div>)}
            {!audit.length && <div className="event"><strong>Workspace ready</strong><p>Recorded changes will appear here with their effective dates and audit history.</p></div>}
          </div></div>
        </div>
      </div>
    </>
  );
}
