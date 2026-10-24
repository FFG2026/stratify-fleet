import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, orgName } from '@/lib/data';
import { claimSide, countClaims, getNotices, listClaims, canLogClaims, canReportClaims, type ClaimRow } from '@/lib/claims-data';
import { statusLabel, needsFleetAction, needsInsurerAction, type ClaimStatus } from '@/lib/claims';
import { PageHeader, Badge, Notice, Stats, LinkButton, Pagination } from '@/components/ui';
import { MarkRead } from '@/components/ClaimForms';
import { londonDateTime, londonShortDate } from '@/lib/dates';

type SP = { view?: string; q?: string; offset?: string };
const views = [['open', 'Open'], ['action', 'Needs action'], ['closed', 'Closed'], ['all', 'All']] as const;

function nextStep(side: string, c: ClaimRow): string {
  if (side === 'fleet') return c.status === 'reported' ? (c.assessed_at ? 'Ready to send' : 'Review and send') : c.status === 'awaiting_information' ? 'Answer the insurer' : '';
  if (side === 'insurer') return c.status === 'submitted' ? 'Start review' : c.status === 'awaiting_information' ? 'Waiting for the fleet' : '';
  return c.status === 'reported' ? 'With your fleet' : '';
}

export default async function Claims({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const side = claimSide(ctx);
  if (ctx.demo) {
    return (<><PageHeader crumb="CLAIMS" title="Claims / FNOL" subtitle="Report, assess and follow claims." /><Notice>Claims are not available in the demonstration workspace. Sign in with a development account to use them.</Notice></>);
  }
  if (!side) {
    return (<><PageHeader crumb="CLAIMS" title="Claims / FNOL" subtitle="Report, assess and follow claims." /><Notice>Your role does not include claims. Ask your administrator if you need access.</Notice></>);
  }
  const sp = await searchParams;
  const view = views.some(v => v[0] === sp.view) ? sp.view! : side === 'driver' ? 'all' : 'open';
  const actionStatuses = side === 'insurer' ? needsInsurerAction : needsFleetAction;
  const status = view === 'open' ? 'open' : view === 'closed' ? 'closed' : view === 'action' ? 'in:' + actionStatuses.join(',') : undefined;
  const offset = Math.max(0, Number(sp.offset) || 0);
  let error = '';
  let page = { rows: [] as ClaimRow[], total: 0 };
  let notices: Awaited<ReturnType<typeof getNotices>> = [];
  let counts = { open: 0, action: 0, injury: 0, closed: 0 };
  try {
    const [pg, nt, nOpen, nAction, nInjury, nClosed] = await Promise.all([
      listClaims({ status, q: sp.q, offset, limit: 25 }), getNotices(8), countClaims('status=neq.closed'),
      side === 'driver' ? Promise.resolve(0) : countClaims('status=in.(' + actionStatuses.join(',') + ')'), countClaims('status=neq.closed&anyone_injured=eq.true'), countClaims('status=eq.closed')
    ]);
    page = pg; notices = nt; counts = { open: nOpen, action: nAction, injury: nInjury, closed: nClosed };
  } catch (e) { error = e instanceof Error ? e.message : 'Unable to load claims.'; }
  const base = new URLSearchParams({ view }); if (sp.q) base.set('q', sp.q);
  const unread = notices.filter(n => !n.read_at);
  return (
    <>
      <PageHeader crumb="CLAIMS" title="Claims / FNOL"
        subtitle={side === 'insurer' ? 'Claims sent to you by your fleets, and claims you log yourself.' : side === 'fleet' ? 'Claims reported by your drivers and your team. Review them, then send them to the insurer.' : 'Report an incident and follow your claims.'}
        actions={canReportClaims(ctx) ? <LinkButton primary href="/claims/new">Report a claim</LinkButton> : canLogClaims(ctx) ? <LinkButton primary href="/claims/new">Log a claim</LinkButton> : undefined} />
      {error && <Notice alert>{error}</Notice>}
      <Stats items={[
        ['Open claims', counts.open, 'Not yet closed', '/claims?view=open'],
        ...(side === 'driver' ? [] : [['Need action', counts.action, side === 'insurer' ? 'Waiting for you to start' : 'To review, send or answer', '/claims?view=action'] as [string, number, string, string]]),
        ['Injury reported', counts.injury, 'Open claims', '/claims?view=open'],
        ['Closed', counts.closed, 'Completed', '/claims?view=closed']
      ]} />
      {notices.length > 0 && (
        <section className="panel" aria-label="Notifications">
          <div className="panel-header"><div><h2>Notifications</h2><p className="subtext">{unread.length ? `${unread.length} new` : 'Nothing new'}. These are in-portal notices; email alerts are not set up yet.</p></div>{unread.length > 0 && <MarkRead />}</div>
          <ul className="notices">
            {notices.map(n => (
              <li key={n.id} className={n.read_at ? '' : 'unread'}>
                {n.claim_id ? <Link prefetch={false} href={'/claims/' + n.claim_id}><strong>{n.title}</strong></Link> : <strong>{n.title}</strong>}
                {n.body && <span> {n.body}</span>}
                <span className="subtext"> {londonDateTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="tabs-row" role="tablist" aria-label="Claim views">
        {views.filter(v => side !== 'driver' || v[0] !== 'action').map(([key, label]) => <Link key={key} prefetch={false} className={'button-link' + (view === key ? ' primary' : '')} href={'/claims?view=' + key}>{label}</Link>)}
        <form className="crm-search" action="/claims"><input type="hidden" name="view" value="all" /><input name="q" defaultValue={sp.q ?? ''} placeholder="Reference or registration" aria-label="Search claims" /><button>Search</button></form>
      </div>
      <section className="panel">
        <div className="table-scroll"><table>
          <thead><tr><th>Reference</th>{side === 'insurer' && <th>Fleet</th>}<th>Incident</th><th>Vehicle</th><th>Driver</th><th>Injury</th><th>Status</th><th>Next step</th><th>Updated</th></tr></thead>
          <tbody>
            {page.rows.map(c => {
              const step = nextStep(side, c);
              return (
                <tr key={c.id}>
                  <td><Link prefetch={false} href={'/claims/' + c.id}><strong>{c.reference}</strong></Link></td>
                  {side === 'insurer' && <td>{orgName(ctx, c.fleet_id)}</td>}
                  <td>{londonShortDate(c.incident_at)}</td>
                  <td><span className="registration">{c.registration}</span></td>
                  <td>{c.driver_name || '—'}</td>
                  <td>{c.anyone_injured ? <Badge warn>Injury</Badge> : 'No'}</td>
                  <td><Badge warn={c.status !== 'closed'}>{statusLabel[c.status as ClaimStatus] ?? c.status}</Badge></td>
                  <td>{step ? <strong>{step}</strong> : '—'}</td>
                  <td>{londonShortDate(c.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!page.rows.length && <div className="empty">{sp.q ? 'No claims match that search.' : view === 'action' ? 'Nothing needs your action.' : 'No claims here yet.'}</div>}
        <Pagination total={page.total} offset={offset} base={base} />
      </section>
    </>
  );
}
