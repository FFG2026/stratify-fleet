import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, canViewRates, orgName, isInsurerSide } from '@/lib/data';
import { rpc } from '@/lib/rest';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { PrintButton } from '@/components/ReportControls';
import { gbp, shortDate } from '@/lib/bordereau';
import { bandLabel, burnBand, burnTotals, type BurnRow } from '@/lib/burn';

export default async function BurnRate({ searchParams }: { searchParams: Promise<{ insurer?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!isInsurerSide(ctx) || !canViewRates(ctx)) redirect('/');
  const header = <PageHeader crumb="FINANCE" title="Burn rate" subtitle="Claims cost as a percentage of premium, for each customer policy." actions={<PrintButton />} />;
  if (ctx.demo) return <>{header}<Notice>Not available in the demonstration workspace.</Notice></>;
  const sp = await searchParams;
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const insurerId = insurers.find(i => i.id === sp.insurer)?.id ?? insurers[0]?.id;
  let rows: BurnRow[] = [], error = '';
  if (insurerId) { try { rows = await rpc<BurnRow[]>('insurer_burn_rate', { p_insurer: insurerId }); } catch (e) { error = e instanceof Error ? e.message : 'Unable to calculate burn rate.'; } }
  const t = burnTotals(rows);
  return (
    <>
      {header}
      {insurers.length > 1 && <div className="filters"><ParamSelect name="insurer" label="Insurer" value={insurerId ?? ''} options={insurers.map(i => ({ value: i.id, label: i.name }))} /></div>}
      {error && <Notice alert>{error}</Notice>}
      <Notice>Burn rate = claims incurred (paid plus reserve) ÷ net premium earned (before IPT) × 100, for {orgName(ctx, insurerId)}. Premium is earned from the later of the policy start and 12 months ago, up to today. Claims counted are those submitted to the insurer with an incident in that period. Record each claim&rsquo;s paid and reserve figures on the claim page. The customer never sees claim costs.</Notice>
      {rows.length > 0 && (
        <div className="stats">
          <div className="stat"><div className="stat-label">Book burn rate</div><div className="stat-number">{t.pct === null ? '—' : t.pct.toFixed(1) + '%'}</div><div className="stat-note">All policies</div></div>
          <div className="stat"><div className="stat-label">Premium earned (net)</div><div className="stat-number">{gbp(t.earned)}</div><div className="stat-note">Before IPT</div></div>
          <div className="stat"><div className="stat-label">Claims incurred</div><div className="stat-number">{gbp(t.incurred)}</div><div className="stat-note">{t.claims} claims</div></div>
        </div>
      )}
      {!rows.length && !error && <div className="empty">No policies with cover yet.</div>}
      {rows.length > 0 && (
        <div className="panel"><div className="table-scroll"><table>
          <thead><tr><th>Customer</th><th>Policy</th><th>Vehicles</th><th>Price per vehicle</th><th>Premium earned</th><th>Claims</th><th>Paid</th><th>Reserve</th><th>Incurred</th><th>Burn rate</th></tr></thead>
          <tbody>{rows.map(r => {
            const band = burnBand(r.burn_rate_pct);
            return (
              <tr key={r.policy_id}><td>{r.fleet_name}</td><td>{r.policy_number}<div className="subtext">since {shortDate(r.period_from)}</div></td><td>{r.vehicles}</td>
                <td>{r.monthly_price === null ? '—' : gbp(r.monthly_price) + ' a month'}{r.daily_rate !== null && <div className="subtext">{gbp(r.daily_rate)} a day</div>}</td>
                <td>{gbp(r.earned_net)}</td><td>{r.claims}</td><td>{gbp(r.paid)}</td><td>{gbp(r.reserve)}</td><td><strong>{gbp(r.incurred)}</strong></td>
                <td><strong>{r.burn_rate_pct === null ? '—' : Number(r.burn_rate_pct).toFixed(1) + '%'}</strong> <Badge warn={band === 'watch' || band === 'high'}>{bandLabel[band]}</Badge></td></tr>
            );
          })}</tbody>
          <tfoot><tr><th colSpan={4}>Total</th><th>{gbp(t.earned)}</th><th>{t.claims}</th><th></th><th></th><th>{gbp(t.incurred)}</th><th>{t.pct === null ? '—' : t.pct.toFixed(1) + '%'}</th></tr></tfoot>
        </table></div></div>
      )}
      <p className="subtext">Guide: under 60% healthy, 60–80% watch, over 80% high. <Link href="/claims">Open claims →</Link></p>
    </>
  );
}
