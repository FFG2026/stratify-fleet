import { redirect } from 'next/navigation';
import { getContext, canViewAudit, orgName } from '@/lib/data';
import { rpc } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { londonDateTime } from '@/lib/dates';
import { PageHeader, Pagination, Badge } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';

type Row = { id: number; occurred_at: string; actor_email: string | null; actor_kind: string; organisation_id: string; action: string; entity_type: string; note: string | null; total: number };
const PAGE = 50;

export default async function Audit({ searchParams }: { searchParams: Promise<{ org?: string; action?: string; offset?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canViewAudit(ctx)) redirect('/');
  const sp = await searchParams;
  const org = sp.org && ctx.orgs.some(o => o.id === sp.org) ? checkedId(sp.org) : null;
  const action = (sp.action ?? '').trim().slice(0, 60);
  const offset = Math.max(0, Number(sp.offset) || 0);
  const rows = await rpc<Row[]>('audit_feed', { p_org: org, p_action: action || null, p_limit: PAGE, p_offset: offset });
  const total = rows[0]?.total ?? 0;
  const base = new URLSearchParams(); if (org) base.set('org', org); if (action) base.set('action', action);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, and when. Entries cannot be edited or removed." />
      <section className="panel">
        <div className="toolbar">
          {ctx.orgs.length > 1 && <ParamSelect name="org" label="Organisation" value={org ?? ''} options={[{ value: '', label: 'All I can see' }, ...ctx.orgs.map(o => ({ value: o.id, label: o.name }))]} resetParams={['offset']} />}
          <form method="get" className="inline-form">
            {org && <input type="hidden" name="org" value={org} />}
            <label>Action starts with<input name="action" defaultValue={action} maxLength={60} placeholder="e.g. coverage. or claim." autoComplete="off" /></label>
            <button>Filter</button>
          </form>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>When</th><th>Who</th><th>Organisation</th><th>Action</th><th>About</th><th>Note</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>{londonDateTime(r.occurred_at)}</td>
              <td>{r.actor_email ?? (r.actor_kind === 'system' ? <Badge>System</Badge> : 'Unknown')}</td>
              <td>{orgName(ctx, r.organisation_id)}</td>
              <td><code>{r.action}</code></td><td>{r.entity_type.replaceAll('_', ' ')}</td><td>{r.note ?? ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!rows.length && <div className="empty">No entries match.</div>}
        <Pagination total={total} offset={offset} limit={PAGE} base={base} />
      </section>
    </>
  );
}
