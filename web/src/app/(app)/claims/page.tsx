import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, orgName } from '@/lib/data';
import { digestOn, listClaimHandlers, claimSide, countClaims, getNotices, listClaims, listInboxClaims, canLogClaims, canReportClaims, type ClaimRow } from '@/lib/claims-data';
import { statusLabel, needsFleetAction, type ClaimStatus } from '@/lib/claims';
import { PageHeader, Badge, Notice, Stats, LinkButton, Pagination } from '@/components/ui';
import { MarkRead } from '@/components/ClaimForms';
import { BulkBar, DigestToggle } from '@/components/InboxBulk';
import { InboxTable } from '@/components/InboxViews';
import { demoInboxClaims, isDemoInboxClaim } from '@/lib/demo-inbox';
import { filterInbox, inboxCounts, inboxQueues, type InboxQueue } from '@/lib/inbox';
import { londonDateTime, londonShortDate } from '@/lib/dates';

type SP = { view?: string; q?: string; offset?: string; queue?: string };
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
  if (!side) {
    return (<><PageHeader crumb="CLAIMS" title="Claims / FNOL" subtitle="Report, assess and follow claims." /><Notice>Your role does not include claims. Ask your administrator if you need access.</Notice></>);
  }
  if (side === 'insurer') return <InsurerInbox ctx={ctx} searchParams={searchParams} />;
  const sp = await searchParams;
  const view = views.some(v => v[0] === sp.view) ? sp.view! : side === 'driver' ? 'all' : 'open';
  const actionStatuses = needsFleetAction;
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
        subtitle={side === 'fleet' ? 'Claims reported by your drivers and your team. Review them, then send them to the insurer.' : 'Report an incident and follow your claims.'}
        actions={canReportClaims(ctx) ? <LinkButton primary href="/claims/new">Report a claim</LinkButton> : undefined} />
      {error && <Notice alert>{error}</Notice>}
      <Stats items={[
        ['Open claims', counts.open, 'Not yet closed', '/claims?view=open'],
        ...(side === 'driver' ? [] : [['Need action', counts.action, 'To review, send or answer', '/claims?view=action'] as [string, number, string, string]]),
        ['Injury reported', counts.injury, 'Open claims', '/claims?view=open'],
        ['Closed', counts.closed, 'Completed', '/claims?view=closed']
      ]} />
      {notices.length > 0 && (
        <section className="panel" aria-label="Notifications">
          <div className="panel-header"><div><h2>Notifications</h2><p className="subtext">{unread.length ? `${unread.length} new` : 'Nothing new'}.</p></div>{unread.length > 0 && <MarkRead />}</div>
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
          <thead><tr><th>Reference</th><th>Incident</th><th>Vehicle</th><th>Driver</th><th>Injury</th><th>Status</th><th>Next step</th><th>Updated</th></tr></thead>
          <tbody>
            {page.rows.map(c => {
              const step = nextStep(side, c);
              return (
                <tr key={c.id}>
                  <td><Link prefetch={false} href={'/claims/' + c.id}><strong>{c.reference}</strong></Link></td>
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

async function InsurerInbox({ ctx, searchParams }: { ctx: NonNullable<Awaited<ReturnType<typeof getContext>>>; searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const queue = inboxQueues.some(q => q.id === sp.queue) ? sp.queue as InboxQueue : 'unassigned';
  const now = new Date();
  const me = ctx.user.id;
  let error = '';
  const fixtures = demoInboxClaims(now, me);
  let rows = fixtures;
  let notices: Awaited<ReturnType<typeof getNotices>> = [];
  if (!ctx.demo) {
    try {
      const [inbox, nt] = await Promise.all([listInboxClaims(), getNotices(8)]);
      rows = [...fixtures, ...inbox];
      notices = nt;
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to load claims.'; }
  }
  const q = (sp.q ?? '').trim().toLowerCase();
  const searched = q ? rows.filter(c => c.reference.toLowerCase().includes(q) || c.registration.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, ''))) : rows;
  const visible = filterInbox(searched, queue, me, now);
  const counts = inboxCounts(rows, me, now);
  const unread = notices.filter(n => !n.read_at);
  const firstLive = visible.find(c => !isDemoInboxClaim(c.id));
  const bulk = !ctx.demo && !!firstLive;
  const handlers = bulk && firstLive ? await listClaimHandlers(firstLive.id) : [];
  const digest = ctx.demo ? true : await digestOn();
  return (
    <>
      <PageHeader crumb="CLAIMS" title="Claims inbox"
        subtitle="Who owns each sent claim, and whether a clock has run out. This is not a claims-paying system."
        actions={canLogClaims(ctx) ? <LinkButton primary href="/claims/new">Log a claim</LinkButton> : undefined} />
      <Notice>Demonstration claims are included so you can walk an insurer through the inbox. They are fictional and cannot be saved. Live sent claims appear in the same queues.</Notice>
      {error && <Notice alert>{error}</Notice>}
      <Stats items={[
        ['Mine', counts.mine, 'Assigned to you', '/claims?queue=mine'],
        ['Unassigned', counts.unassigned, 'Nobody owns these', '/claims?queue=unassigned'],
        ['Waiting on fleet', counts.waiting, 'We have asked, they have not replied', '/claims?queue=waiting'],
        ['Overdue', counts.overdue, 'A clock has run out', '/claims?queue=overdue'],
        ['Need action', counts.action, 'Unassigned, new, or your overdue', '/claims?queue=unassigned']
      ]} />
      {notices.length > 0 && (
        <section className="panel" aria-label="Notifications">
          <div className="panel-header"><div><h2>Notifications</h2><p className="subtext">{unread.length ? `${unread.length} new` : 'Nothing new'}.</p></div>{unread.length > 0 && <MarkRead />}</div>
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
      {!ctx.demo && <DigestToggle on={digest} />}
      <div className="tabs-row" role="tablist" aria-label="Inbox queues">
        {inboxQueues.map(item => (
          <Link key={item.id} prefetch={false} className={'button-link' + (queue === item.id ? ' primary' : '')} href={'/claims?queue=' + item.id}>
            {item.label} · {counts[item.id]}
          </Link>
        ))}
        <form className="crm-search" action="/claims"><input type="hidden" name="queue" value={queue} /><input name="q" defaultValue={sp.q ?? ''} placeholder="Reference or registration" aria-label="Search claims" /><button>Search</button></form>
      </div>
      <section className="panel">
        {bulk && <BulkBar handlers={handlers} me={me} />}
        <InboxTable ctx={ctx} rows={visible} me={me} now={now} selectable={bulk} />
        {!visible.length && <div className="empty">{q ? 'No claims match that search in this queue.' : 'Nothing in this queue.'}</div>}
      </section>
    </>
  );
}
