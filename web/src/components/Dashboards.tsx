import Link from 'next/link';
import type { Context, Period } from '@/lib/types';
import { orgName, type DashEvent } from '@/lib/data';
import type { FleetOverviewRow } from '@/lib/types';
import { Badge, FleetTable, Stats, fmt } from './ui';
import { londonDateTime, londonShortDate } from '@/lib/dates';
import { ParamSelect } from './ParamSelect';

const Attention = ({ icon, title, text, href }: { icon: string; title: string; text: string; href?: string }) => (
  <div className="attention">
    <span className="attention-icon">{icon}</span>
    <div><h3>{title}</h3><p>{text}</p></div>
    {href && <Link prefetch={false} className="textbtn" href={href} aria-label={title}>↗</Link>}
  </div>
);

const eventText = (t: string) => (t === 'cover_added' ? 'added to cover' : t === 'cover_removed' ? 'removed from cover' : 'cover record corrected');

export function LiveDashboard({ ctx, data, insurerFilter, showInsurerPicker }: {
  ctx: Context; insurerFilter: string; showInsurerPicker: boolean;
  data: { fleets: FleetOverviewRow[]; counts: { added7: number; removed7: number; scheduledAdds: number; scheduledRemovals: number; provisionalReports: number }; events: DashEvent[] };
}) {
  const { fleets, counts: c, events } = data;
  const sum = (k: 'vehicles_on_cover') => fleets.reduce((a, f) => a + Number(f[k] || 0), 0);
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const fleetName = (id: string) => fleets.find(f => f.fleet_id === id)?.fleet_name || orgName(ctx, id);
  return (
    <>
      {showInsurerPicker && insurers.length > 1 && (
        <div className="filters">
          <ParamSelect name="insurer" label="Insurer" value={insurerFilter} options={[{ value: '', label: 'All authorised insurers' }, ...insurers.map(o => ({ value: o.id, label: o.name }))]} />
        </div>
      )}
      <Stats items={[
        ['Fleet customers', fleets.length, 'In this view'],
        ['Vehicles on cover', sum('vehicles_on_cover'), 'Covered right now'],
        ['Added / removed (7 days)', `${c.added7} / ${c.removed7}`, 'Recorded changes'],
        ['Scheduled changes', c.scheduledAdds + c.scheduledRemovals, `${c.scheduledAdds} additions · ${c.scheduledRemovals} removals in the next 7 days`]
      ]} />
      <div className="grid-two">
        <div className="panel">
          <div className="panel-header"><h2>Latest changes</h2><Link prefetch={false} className="textbtn" href="/changes">Manage cover →</Link></div>
          <div className="panel-body"><div className="timeline">
            {events.map(e => (
              <div className="event" key={e.id}>
                <strong>{e.details?.registration || 'Vehicle'}</strong> · {eventText(e.event_type)} · {fleetName(e.fleet_id)}
                <p>Effective {londonShortDate(e.effective_at)} · recorded {londonDateTime(e.recorded_at)}</p>
              </div>
            ))}
            {!events.length && <div className="event"><strong>No changes recorded yet</strong><p>Vehicles added or removed will appear here.</p></div>}
          </div></div>
        </div>
        <section className="panel sage"><div className="panel-body">
          <div className="cardhead"><h2>Needs your attention</h2><Badge>Live</Badge></div>
          <Attention icon={String(c.scheduledAdds + c.scheduledRemovals)} title="Scheduled cover changes" text="Taking effect in the next 7 days." />
          <Attention icon={String(c.provisionalReports)} title="Provisional reconciliations" text="Generated in the last 30 days. None can be finalised yet." href="/reconciliation" />
          <Attention icon="⇄" title="MIB / MID integration" text="Not connected. No external submissions are sent." />
        </div></section>
      </div>
      <section className="panel">
        <div className="panel-header"><div><h2>Fleet portfolio</h2><p className="subtext">Vehicles per customer, from live records</p></div><span className="muted">{fleets.length} fleets</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Customer</th><th>Insurer</th><th>Vehicles</th><th>On cover</th><th>Scheduled</th><th>Workspace</th></tr></thead>
          <tbody>
            {fleets.map(f => {
              const pol = ctx.policies.find(p => p.customer_id === f.fleet_id);
              return (
                <tr key={f.fleet_id}>
                  <td><div className="company"><span className="company-logo">{f.fleet_name.slice(0, 1)}</span><strong>{f.fleet_name}</strong></div></td>
                  <td>{orgName(ctx, f.insurer_id)}</td>
                  <td>{fmt(f.vehicles_total)}</td><td>{fmt(f.vehicles_on_cover)}</td><td>{fmt(f.vehicles_scheduled)}</td>
                  <td>{pol ? <Link prefetch={false} className="textbtn" href={'/fleet?policy=' + pol.id}>Open fleet ↗</Link> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!fleets.length && <div className="empty">No fleet customers in this view.</div>}
      </section>
    </>
  );
}

export function StaticDashboard({ ctx, summary, showOrgNote }: {
  ctx: Context; showOrgNote: boolean;
  summary: { periods: number; covered: number; recent: Period[]; events: { id: string | number; registration: string; action: string; created_at: string }[] };
}) {
  const customers = ctx.orgs.filter(o => o.kind === 'customer');
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const membership = ctx.memberships.filter(m => m.active).length;
  return (
    <>
      <Stats items={[
        ['Covered vehicles', summary.covered, 'As at today'],
        ['Customers', customers.length, 'Within your permitted portfolio'],
        ['Policies', ctx.policies.length, 'Authorised policy records'],
        ['Coverage periods', summary.periods, 'Historical and current records']
      ]} />
      <div className="grid-two">
        <div className="panel">
          <div className="panel-header"><h2>Coverage activity</h2><Link prefetch={false} className="textbtn" href="/changes">Manage cover →</Link></div>
          <div className="panel-body"><div className="timeline">
            {summary.events.slice(0, 5).map(e => (
              <div className="event" key={e.id}><strong>{e.registration}</strong> · {e.action}<p>{londonDateTime(e.created_at)}</p></div>
            ))}
            {!summary.events.length && <div className="event"><strong>Workspace ready</strong><p>Recorded changes will appear here with their effective dates and audit history.</p></div>}
          </div></div>
        </div>
        <section className="panel sage"><div className="panel-body">
          <div className="cardhead"><h2>Needs your attention</h2><Badge>Workspace checks</Badge></div>
          <Attention icon={membership || ctx.demo ? '✓' : '!'} title="Organisation access" text={ctx.demo ? 'Demonstration workspace' : membership ? 'Your membership controls which records you can view.' : 'Your account needs an organisation membership before records are available.'} />
          <Attention icon="▥" title="Month-end reconciliation" text="Review saved statements and insured vehicle-days." href="/reconciliation" />
          <Attention icon="⇄" title="MIB / MID integration" text="Not connected. No external submissions are sent." />
        </div></section>
      </div>
      {showOrgNote && <div className="notice">{insurers.length} insurer workspaces · {customers.length} fleet customers · All figures reflect records available to your signed-in account.</div>}
      <section className="panel">
        <div className="panel-header"><div><h2>Fleet portfolio</h2><p className="subtext">Customers in your authorised workspace</p></div><span className="muted">{customers.length} fleets</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Customer</th><th>Insurer</th><th>Policies</th><th>Workspace</th></tr></thead>
          <tbody>
            {customers.map(o => {
              const policies = ctx.policies.filter(p => p.customer_id === o.id);
              const names = [...new Set(policies.map(p => orgName(ctx, p.insurer_id)))];
              return (
                <tr key={o.id}>
                  <td><div className="company"><span className="company-logo">{o.name.slice(0, 1)}</span><strong>{o.name}</strong></div></td>
                  <td>{names.join(', ') || '—'}</td><td>{policies.length}</td>
                  <td>{policies.length ? <Link prefetch={false} className="textbtn" href={'/fleet?policy=' + policies[0].id}>Open fleet ↗</Link> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!customers.length && <div className="empty">No authorised organisations yet. Your administrator must assign organisation membership.</div>}
      </section>
      <div className="panel">
        <div className="panel-header"><h2>Recent coverage periods</h2><Link prefetch={false} className="textbtn" href="/fleet">View vehicle register →</Link></div>
        <FleetTable ctx={ctx} rows={summary.recent} />
      </div>
    </>
  );
}
