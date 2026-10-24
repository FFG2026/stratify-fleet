import { redirect } from 'next/navigation';
import { getContext, fleetRegister, isDriverOnly } from '@/lib/data';
import { PageHeader, LinkButton, FleetTable, Pagination, Notice } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';

type SP = { q?: string; status?: string; policy?: string; offset?: string };

export default async function Fleet({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx)) redirect('/driver');
  const sp = await searchParams;
  let error = '';
  let page = { rows: [] as Awaited<ReturnType<typeof fleetRegister>>['rows'], total: 0, offset: 0, limit: 25 };
  try { page = await fleetRegister(ctx, { q: sp.q, status: sp.status, policy: sp.policy, offset: sp.offset }); }
  catch (e) { error = e instanceof Error ? e.message : 'Unable to load vehicles.'; }
  const base = new URLSearchParams(); for (const k of ['q', 'status', 'policy'] as const) if (sp[k]) base.set(k, sp[k]!);
  return (
    <>
      <PageHeader title="Vehicle register" subtitle="A single source of truth for every vehicle."
        actions={<><LinkButton href="/reconciliation">Open reconciliation →</LinkButton><LinkButton href="/changes" primary>＋ Add vehicle</LinkButton></>} />
      <div className="filters">
        <form method="get" className="filters">
          <label>Search vehicles<input name="q" type="search" maxLength={80} defaultValue={sp.q ?? ''} placeholder="Registration, make or model" /></label>
          {sp.policy && <input type="hidden" name="policy" value={sp.policy} />}
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <button>Search</button>
        </form>
        <ParamSelect name="policy" label="Policy" value={sp.policy ?? ''} options={[{ value: '', label: 'All authorised policies' }, ...ctx.policies.map(p => ({ value: p.id, label: p.reference }))]} />
      </div>
      {error && <Notice alert>{error}</Notice>}
      <div className="panel">
        <div className="panel-header">
          <h2>Coverage register</h2>
          <ParamSelect name="status" label="Show" value={sp.status ?? 'all'} options={[
            { value: 'all', label: 'All periods' }, { value: 'active', label: 'Currently covered' },
            { value: 'closed', label: 'Closed periods' }, { value: 'scheduled', label: 'Scheduled additions' }]} />
        </div>
        <FleetTable ctx={ctx} rows={page.rows} />
        <Pagination total={page.total} offset={page.offset} base={base} />
      </div>
    </>
  );
}
