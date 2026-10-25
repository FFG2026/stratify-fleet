import { redirect } from 'next/navigation';
import { getContext, canViewRates, canManageRates, orgName } from '@/lib/data';
import { rest } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { BillingRulesForm, RateForm } from '@/components/RateForms';

type Rate = { id: string; policy_id: string; effective_from: string; daily_rate: number; note: string | null };
type Rules = { id: string; effective_from: string; start_day_charged: boolean; end_day_charged: boolean; timezone: string; rounding_dp: number; vat_rate: number; note: string | null };
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });

export default async function Rates({ searchParams }: { searchParams: Promise<{ insurer?: string; policy?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canViewRates(ctx)) redirect('/');
  const sp = await searchParams;
  const manage = canManageRates(ctx);
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  let selectedPolicy = ctx.policies.find(p => p.id === sp.policy);
  const insurerId = insurers.find(i => i.id === sp.insurer)?.id ?? selectedPolicy?.insurer_id ?? insurers[0]?.id;
  if (!insurerId) return <><PageHeader title="Rates & billing rules" subtitle="The insurer's own figures." /><Notice>No insurer is available to you.</Notice></>;
  const policies = ctx.policies.filter(p => p.insurer_id === insurerId);
  if (selectedPolicy && selectedPolicy.insurer_id !== insurerId) selectedPolicy = undefined;
  selectedPolicy ??= policies[0];
  const [rules, rates] = await Promise.all([
    rest<Rules[]>('/rest/v1/billing_rules?select=id,effective_from,start_day_charged,end_day_charged,timezone,rounding_dp,vat_rate,note&insurer_id=eq.' + checkedId(insurerId) + '&order=effective_from.desc&limit=50'),
    selectedPolicy ? rest<Rate[]>('/rest/v1/rate_cards?select=id,policy_id,effective_from,daily_rate,note&policy_id=eq.' + checkedId(selectedPolicy.id) + '&order=effective_from.desc&limit=100') : Promise.resolve([] as Rate[]),
  ]);
  // Latest rate already set for each of this insurer's other policies, offered as a starting point for a new company.
  const others = policies.filter(p => p.id !== selectedPolicy?.id);
  const otherRates = manage && others.length
    ? await rest<Rate[]>('/rest/v1/rate_cards?select=id,policy_id,effective_from,daily_rate,note&policy_id=in.(' + others.map(p => checkedId(p.id)).join(',') + ')&order=effective_from.desc&limit=500')
    : [];
  const presets = others.flatMap(p => {
    const latest = otherRates.find(r => r.policy_id === p.id);
    return latest ? [{ label: `£${Number(latest.daily_rate).toFixed(4)} — ${orgName(ctx, p.customer_id)} (${p.reference})`, rate: Number(latest.daily_rate) }] : [];
  });
  return (
    <>
      <PageHeader title="Rates & billing rules" subtitle="The insurer's own figures. They drive the reconciliation reports." />
      <Notice>Nothing here is pre-filled by the portal. Each new rate or rule applies from its date and earlier ones are kept, so past reports never change. Daily rates are entered excluding IPT; IPT is added on top using the rate in the billing rules.</Notice>
      {insurers.length > 1 && <div className="filters"><ParamSelect name="insurer" label="Insurer" value={insurerId} resetParams={['policy']} options={insurers.map(i => ({ value: i.id, label: i.name }))} /></div>}
      <section className="panel">
        <div className="panel-header"><h2>Billing rules — {orgName(ctx, insurerId)}</h2></div>
        {!rules.length && <Notice alert>No billing rules are set. Reconciliation falls back to its built-in assumption until you add them.</Notice>}
        {rules.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th>From</th><th>Start day</th><th>End day</th><th>Time zone</th><th>Rounding</th><th>IPT rate</th><th>Note</th></tr></thead>
          <tbody>{rules.map((r, i) => (
            <tr key={r.id}><td>{day(r.effective_from)} {i === 0 && <Badge>Latest</Badge>}</td><td>{r.start_day_charged ? 'Charged' : 'Not charged'}</td><td>{r.end_day_charged ? 'Charged' : 'Not charged'}</td><td>{r.timezone}</td><td>{r.rounding_dp} dp</td><td>{r.vat_rate}</td><td>{r.note ?? ''}</td></tr>
          ))}</tbody>
        </table></div>}
        {manage ? <div className="panel-body"><h3>Add billing rules</h3><BillingRulesForm insurer={insurerId} /></div> : <div className="panel-body muted">Your role can view billing rules but not change them.</div>}
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Daily rates</h2></div>
        {!policies.length ? <div className="empty">No policies yet.</div> : <>
          <div className="panel-body"><ParamSelect name="policy" label="Policy" value={selectedPolicy?.id ?? ''} resetParams={[]} options={policies.map(p => ({ value: p.id, label: `${p.reference} — ${orgName(ctx, p.customer_id)}` }))} /></div>
          {!rates.length && <Notice alert>No rate is set for this policy, so reconciliation shows days only for it.</Notice>}
          {rates.length > 0 && <div className="table-scroll"><table>
            <thead><tr><th>From</th><th>Daily rate</th><th>Note</th></tr></thead>
            <tbody>{rates.map((r, i) => <tr key={r.id}><td>{day(r.effective_from)} {i === 0 && <Badge>Latest</Badge>}</td><td>£{Number(r.daily_rate).toFixed(4)}</td><td>{r.note ?? ''}</td></tr>)}</tbody>
          </table></div>}
          {manage && selectedPolicy && <div className="panel-body"><h3>Add a rate</h3><p className="subtext">Each company can have its own rate. For a new company, copy one you have already set and change the date.</p><RateForm policy={selectedPolicy.id} reference={selectedPolicy.reference} presets={presets} /></div>}
        </>}
      </section>
    </>
  );
}
