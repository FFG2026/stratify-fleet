import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, canViewRates, orgName } from '@/lib/data';
import { rpc } from '@/lib/rest';
import { today } from '@/lib/dates';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { MonthPicker, ParamSelect } from '@/components/ParamSelect';
import { PrintButton } from '@/components/ReportControls';
import { gbp, isMonth, monthStart, totals, netToInsurer, bordereauRef, shortDate, type BordereauRow, type LineRow, type PendingRow } from '@/lib/bordereau';
import { typeLabel } from '@/lib/referrals';

export default async function Bordereau({ searchParams }: { searchParams: Promise<{ month?: string; insurer?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canViewRates(ctx)) redirect('/');
  const sp = await searchParams;
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const insurerId = insurers.find(i => i.id === sp.insurer)?.id ?? insurers[0]?.id;
  const month = isMonth(sp.month) ? sp.month : today().slice(0, 7);
  let rows: BordereauRow[] = [], lines: LineRow[] = [], pending: PendingRow[] = [], error = '';
  if (insurerId) {
    try {
      const args = { p_insurer: insurerId, p_month: monthStart(month) };
      [rows, lines, pending] = await Promise.all([rpc<BordereauRow[]>('insurer_bordereau', args), rpc<LineRow[]>('insurer_bordereau_lines', args), rpc<PendingRow[]>('insurer_pending_referrals', args)]);
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to build the bordereau.'; }
  }
  const t = totals(rows);
  const missing = rows.filter(r => !r.terms_set).length;
  return (
    <>
      <PageHeader crumb="FINANCE" title="Bordereau" subtitle="Premium and remuneration by policy for the month." actions={<PrintButton />} />
      {insurers.length > 1 && <div className="filters"><ParamSelect name="insurer" label="Insurer" value={insurerId ?? ''} options={insurers.map(i => ({ value: i.id, label: i.name }))} /></div>}
      <div className="filters"><MonthPicker value={month} />
        {rows.length > 0 && <Link className="button" prefetch={false} href={`/bordereau/csv?month=${month}${insurerId ? '&insurer=' + insurerId : ''}`}>Download CSV</Link>}</div>
      {error && <Notice alert>{error}</Notice>}
      {rows.length > 0 && (
        <div className="stats">
          <div className="stat"><div className="stat-label">Bordereau ref</div><div className="stat-number" style={{ fontSize: '1.1rem' }}>{bordereauRef(orgName(ctx, insurerId), month)}</div><div className="stat-note">{orgName(ctx, insurerId)} · {month}</div></div>
          <div className="stat"><div className="stat-label">Added / removed</div><div className="stat-number">{t.additions} / {t.removals}</div><div className="stat-note">Net {t.additions - t.removals >= 0 ? '+' : ''}{t.additions - t.removals} vehicles</div></div>
          <div className="stat"><div className="stat-label">Awaiting authorisation</div><div className="stat-number">{pending.filter(p => p.status === 'awaiting_authorisation').length}</div><div className="stat-note">Not on cover</div></div>
          <div className="stat"><div className="stat-label">Under query</div><div className="stat-number">{pending.filter(p => p.status === 'queried').length}</div><div className="stat-note">Not on cover</div></div>
          <div className="stat"><div className="stat-label">Gross premium (inc IPT)</div><div className="stat-number">{gbp(t.premium_gross)}</div><div className="stat-note">Confirmed cover only</div></div>
          <div className="stat"><div className="stat-label">Commission</div><div className="stat-number">{gbp(t.commission)}</div><div className="stat-note">+ {gbp(t.admin_fees)} fees</div></div>
          <div className="stat"><div className="stat-label">Net premium to insurer</div><div className="stat-number">{gbp(t.premium_gross - t.commission)}</div><div className="stat-note">Gross less commission</div></div>
        </div>
      )}
      {missing > 0 && <Notice alert>{missing} {missing === 1 ? 'policy has' : 'policies have'} no commission or fee terms set, so remuneration shows as £0.00 for {missing === 1 ? 'it' : 'them'}. Set them on the <Link href="/rates">Rates</Link> page.</Notice>}
      <Notice>Calculated live from the vehicle register for {orgName(ctx, insurerId)}, using each policy&rsquo;s own daily rate, IPT and terms. A vehicle removed before its minimum cover period is still billed to the end of that period. Commission is a percentage of net premium (before IPT); addition and removal fees are charged per vehicle added or removed in the month. The fleet never sees commission or fees.</Notice>
      {!rows.length && !error && <div className="empty">No cover in force for any policy in this month.</div>}
      {rows.length > 0 && (
        <div className="panel"><div className="table-scroll"><table>
          <thead><tr><th>Policy</th><th>Customer</th><th>Vehicles</th><th>Added</th><th>Removed</th><th>Vehicle days</th><th>Net premium</th><th>IPT</th><th>Gross premium</th><th>Commission</th><th>Admin fees</th><th>Remuneration</th><th>Net to insurer</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.policy_id}><td>{r.policy_number}</td><td>{r.fleet_name}</td><td>{r.vehicles}</td><td>{r.additions}</td><td>{r.removals}</td>
              <td>{r.vehicle_days}{r.minimum_period_days > 0 && <div className="subtext">{r.minimum_period_days} days billed from minimum cover</div>}</td>
              <td>{gbp(r.premium_net)}</td><td>{gbp(r.ipt)}</td><td>{gbp(r.premium_gross)}</td>
              <td>{gbp(r.commission)}<div className="subtext">{Number(r.commission_pct)}%</div></td>
              <td>{gbp(r.admin_fees)}{r.admin_fees > 0 && <div className="subtext">{r.additions}×{gbp(r.addition_fee)} + {r.removals}×{gbp(r.removal_fee)}</div>}</td>
              <td><strong>{gbp(r.remuneration)}</strong>{!r.terms_set && <> <Badge warn>No terms</Badge></>}</td><td>{gbp(netToInsurer(r))}</td></tr>
          ))}</tbody>
          <tfoot><tr><th colSpan={2}>Total</th><th>{t.vehicles}</th><th>{t.additions}</th><th>{t.removals}</th><th>{t.vehicle_days}</th><th>{gbp(t.premium_net)}</th><th>{gbp(t.ipt)}</th><th>{gbp(t.premium_gross)}</th><th>{gbp(t.commission)}</th><th>{gbp(t.admin_fees)}</th><th>{gbp(t.remuneration)}</th><th>{gbp(t.premium_gross - t.commission)}</th></tr></tfoot>
        </table></div></div>
      )}
      {lines.length > 0 && (
        <section className="panel">
          <div className="panel-header"><h2>Vehicle movements this month</h2></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Policy</th><th>Customer</th><th>Registration</th><th>Vehicle</th><th>Added</th><th>Removed</th><th>Status</th><th>Days billed</th><th>Net premium</th><th>IPT</th><th>Gross</th><th>Commission</th><th>Net to insurer</th></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={l.policy_id + l.registration + i}><td>{l.policy_number}</td><td>{l.fleet_name}</td><td><span className="registration">{l.registration}</span></td><td>{l.make_model ?? ''}</td>
                <td>{shortDate(l.added_on)}</td><td>{shortDate(l.removed_on)}</td><td><Badge>{l.status}</Badge></td>
                <td>{l.days}{l.minimum_days > 0 && <div className="subtext">{l.minimum_days} from minimum cover</div>}</td>
                <td>{gbp(l.premium_net)}</td><td>{gbp(l.ipt)}</td><td>{gbp(l.premium_gross)}</td><td>{gbp(l.commission)}</td><td>{gbp(l.net_to_insurer)}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      <section className="panel">
        <div className="panel-header"><h2>Awaiting authorisation or under query</h2><Link href="/referrals">Open Authorisations →</Link></div>
        {!pending.length ? <div className="panel-body muted">No vehicles are waiting.</div> : <>
          <div className="table-scroll"><table>
            <thead><tr><th>Policy</th><th>Customer</th><th>Registration</th><th>Vehicle</th><th>Type</th><th>Status</th><th>Requested</th><th>Estimated net premium</th></tr></thead>
            <tbody>{pending.map(q => <tr key={q.id}><td>{q.policy_number}</td><td>{q.fleet_name}</td><td><span className="registration">{q.registration}</span></td><td>{q.make_model ?? ''}</td><td>{typeLabel(q.vehicle_type)}</td>
              <td><Badge warn>{q.status === 'queried' ? 'Under query' : 'Awaiting authorisation'}</Badge></td><td>{shortDate(q.requested_on)}</td><td>{gbp(q.estimated_net)}</td></tr>)}</tbody>
          </table></div>
          <div className="panel-body subtext">Not on cover and not included in the totals above until authorised and bound.</div>
        </>}
      </section>
    </>
  );
}
