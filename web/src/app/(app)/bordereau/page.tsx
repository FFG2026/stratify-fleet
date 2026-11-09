import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, canViewRates, orgName } from '@/lib/data';
import { rpc } from '@/lib/rest';
import { today } from '@/lib/dates';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { MonthPicker, ParamSelect } from '@/components/ParamSelect';
import { PrintButton } from '@/components/ReportControls';
import { gbp, isMonth, monthStart, totals, type BordereauRow } from '@/lib/bordereau';

export default async function Bordereau({ searchParams }: { searchParams: Promise<{ month?: string; insurer?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canViewRates(ctx)) redirect('/');
  const sp = await searchParams;
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const insurerId = insurers.find(i => i.id === sp.insurer)?.id ?? insurers[0]?.id;
  const month = isMonth(sp.month) ? sp.month : today().slice(0, 7);
  let rows: BordereauRow[] = [], error = '';
  if (insurerId) {
    try { rows = await rpc<BordereauRow[]>('insurer_bordereau', { p_insurer: insurerId, p_month: monthStart(month) }); }
    catch (e) { error = e instanceof Error ? e.message : 'Unable to build the bordereau.'; }
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
      {missing > 0 && <Notice alert>{missing} {missing === 1 ? 'policy has' : 'policies have'} no commission or fee terms set, so remuneration shows as £0.00 for {missing === 1 ? 'it' : 'them'}. Set them on the <Link href="/rates">Rates</Link> page.</Notice>}
      <Notice>Calculated live from the vehicle register for {orgName(ctx, insurerId)}, using each policy&rsquo;s own daily rate, IPT and terms. A vehicle removed before its minimum cover period is still billed to the end of that period. Commission is a percentage of net premium (before IPT); addition and removal fees are charged per vehicle added or removed in the month. The fleet never sees commission or fees.</Notice>
      {!rows.length && !error && <div className="empty">No cover in force for any policy in this month.</div>}
      {rows.length > 0 && (
        <div className="panel"><div className="table-scroll"><table>
          <thead><tr><th>Policy</th><th>Customer</th><th>Vehicles</th><th>Added</th><th>Removed</th><th>Vehicle days</th><th>Net premium</th><th>IPT</th><th>Gross premium</th><th>Commission</th><th>Admin fees</th><th>Remuneration</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.policy_id}><td>{r.policy_number}</td><td>{r.fleet_name}</td><td>{r.vehicles}</td><td>{r.additions}</td><td>{r.removals}</td>
              <td>{r.vehicle_days}{r.minimum_period_days > 0 && <div className="subtext">{r.minimum_period_days} days billed from minimum cover</div>}</td>
              <td>{gbp(r.premium_net)}</td><td>{gbp(r.ipt)}</td><td>{gbp(r.premium_gross)}</td>
              <td>{gbp(r.commission)}<div className="subtext">{Number(r.commission_pct)}%</div></td>
              <td>{gbp(r.admin_fees)}{r.admin_fees > 0 && <div className="subtext">{r.additions}×{gbp(r.addition_fee)} + {r.removals}×{gbp(r.removal_fee)}</div>}</td>
              <td><strong>{gbp(r.remuneration)}</strong>{!r.terms_set && <> <Badge warn>No terms</Badge></>}</td></tr>
          ))}</tbody>
          <tfoot><tr><th colSpan={2}>Total</th><th>{t.vehicles}</th><th>{t.additions}</th><th>{t.removals}</th><th>{t.vehicle_days}</th><th>{gbp(t.premium_net)}</th><th>{gbp(t.ipt)}</th><th>{gbp(t.premium_gross)}</th><th>{gbp(t.commission)}</th><th>{gbp(t.admin_fees)}</th><th>{gbp(t.remuneration)}</th></tr></tfoot>
        </table></div></div>
      )}
    </>
  );
}
