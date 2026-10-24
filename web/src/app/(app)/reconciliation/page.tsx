import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, canGenerate, canViewRates, getReport, getReportHistory, getMonthPreview, demoPreview, orgName, isDriverOnly } from '@/lib/data';
import { PageHeader, Badge, Notice, Pagination } from '@/components/ui';
import { MonthPicker, ParamSelect } from '@/components/ParamSelect';
import { GenerateForm, PrintButton } from '@/components/ReportControls';
import { londonDateTime, today } from '@/lib/dates';
import { checkedId } from '@/lib/ids';

type SP = { month?: string; policy?: string; report?: string; offset?: string; hoffset?: string };
type Row = { policy_id: string; registration: string; days: number };

export default async function Reconciliation({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx)) redirect('/driver');
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : ctx.demo ? '2026-09' : today().slice(0, 7);
  const policy = sp.policy && ctx.policies.some(p => p.id === sp.policy) ? sp.policy : '';
  const offset = Math.max(0, Number(sp.offset) || 0), hoffset = Math.max(0, Number(sp.hoffset) || 0);
  const ref = (id: string) => ctx.policies.find(p => p.id === id)?.reference;

  let error = '';
  let saved: Awaited<ReturnType<typeof getReport>> = null;
  let history = { rows: [] as Awaited<ReturnType<typeof getReportHistory>>['rows'], total: 0 };
  if (!ctx.demo) {
    try {
      if (sp.report) { checkedId(sp.report); saved = await getReport(sp.report); if (!saved) error = 'Report not found in your authorised workspace.'; }
      const h = await getReportHistory({ month, policy: policy || undefined, offset: String(hoffset), limit: '25' });
      history = { rows: h.rows, total: h.total };
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to load reports.'; }
  }
  let rows: Row[] = [];
  if (saved) {
    const map = new Map<string, Row>();
    for (const l of saved.lines) { const k = l.policy_id + ':' + l.registration; const hit = map.get(k); if (hit) hit.days += l.days; else map.set(k, { policy_id: l.policy_id, registration: l.registration, days: l.days }); }
    rows = [...map.values()];
  } else if (ctx.demo) rows = demoPreview(month, policy || undefined);
  else {
    try { rows = await getMonthPreview(month, policy || undefined); }
    catch (e) { error = error || (e instanceof Error ? e.message : 'Unable to load the live preview.'); }
  }
  const shown = saved ? saved.report.month_start.slice(0, 7) : month;
  const base = new URLSearchParams({ month }); if (policy) base.set('policy', policy); if (sp.report) base.set('report', sp.report);
  const hbase = new URLSearchParams({ month }); if (policy) hbase.set('policy', policy);
  const csvHref = saved ? '/reconciliation/csv?report=' + saved.report.id : ctx.demo ? '/reconciliation/csv?month=' + month + (policy ? '&policy=' + policy : '') : '';
  return (
    <>
      <PageHeader crumb="FINANCE" title="Reconciliation" subtitle="Coverage reconciled down to the vehicle." actions={<PrintButton />} />
      <Notice><strong>Provisional report.</strong> {saved ? `Saved database report ${saved.report.id}. Rules snapshot: ${saved.report.rules_source}.` : ctx.demo ? 'Select a policy and generate a report, or reopen a saved report below. Reports retain the rules and rates used at generation.' : 'Live preview from the vehicle register: every vehicle with cover in the month, counted by date (start date included, removal date excluded). Choose a policy and generate a saved report to apply the insurer\'s stored rules and rates.'} Saved reports follow their stored rules snapshot. The date-only preview includes the start date and excludes the removal date. Report finalisation is not available.</Notice>
      {error && <Notice alert>{error}</Notice>}
      <div className="filters">
        <ParamSelect name="policy" label="Policy" value={policy} options={[{ value: '', label: 'All authorised policies' }, ...ctx.policies.map(p => ({ value: p.id, label: p.reference }))]} />
        <MonthPicker value={month} />
      </div>
      <div className="panel">
        <div className="panel-header">
          <h2>Vehicle-day statement</h2>
          <div className="actions">
            <GenerateForm month={month} policy={policy} allowed={canGenerate(ctx)} />
            {csvHref ? <a className="button-link" href={csvHref}>Export CSV ↓</a> : <button disabled>Export CSV ↓</button>}
          </div>
        </div>
        <div className="report-summary">
          <div><strong>{rows.length.toLocaleString('en-GB')}</strong><span>VEHICLES IN MONTH</span></div>
          <div><strong>{rows.reduce((n, r) => n + r.days, 0).toLocaleString('en-GB')}</strong><span>INSURED VEHICLE-DAYS</span></div>
          <div><strong>{shown}</strong><span>REPORTING MONTH</span></div>
          {saved && canViewRates(ctx) && saved.report.premium_net != null && <>
            <div><strong>£{Number(saved.report.premium_net).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong><span>NET PREMIUM</span></div>
            <div><strong>£{Number(saved.report.vat_amount ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong><span>IPT ({Number(saved.report.rules_snapshot?.vat_rate ?? 0) * 100}%)</span></div>
            <div><strong>£{Number(saved.report.premium_gross ?? saved.report.premium_net).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong><span>GROSS</span></div>
          </>}
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>REGISTRATION</th><th>CUSTOMER</th><th>POLICY</th><th>INSURED DAYS</th><th>REPORT STATUS</th></tr></thead>
          <tbody>
            {rows.slice(offset, offset + 25).map(r => (
              <tr key={r.policy_id + r.registration}>
                <td><span className="registration">{r.registration}</span></td>
                <td>{orgName(ctx, ctx.policies.find(p => p.id === r.policy_id)?.customer_id)}</td>
                <td>{ref(r.policy_id)}</td><td><strong>{r.days}</strong></td><td><Badge warn>Provisional</Badge></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!rows.length && <div className="empty">No vehicles had cover in this month.</div>}
        <Pagination total={rows.length} offset={offset} base={base} />
      </div>
      {ctx.demo ? (
        <div className="panel"><div className="panel-body"><h2>Saved report history</h2><p>Available when the development database is connected.</p></div></div>
      ) : (
        <div className="panel">
          <div className="panel-header"><h2>Saved reports for {month}</h2><Badge>Stored snapshots</Badge></div>
          <div className="table-scroll"><table>
            <thead><tr><th>GENERATED</th><th>POLICY</th><th>VEHICLE-DAYS</th><th>STATUS</th><th>OPEN</th></tr></thead>
            <tbody>
              {history.rows.map(r => {
                const q = new URLSearchParams(hbase); q.set('report', r.id);
                return (
                  <tr key={r.id}>
                    <td>{londonDateTime(r.generated_at)}</td><td>{(r.policy_id && ref(r.policy_id)) || 'Fleet-wide report'}</td>
                    <td>{r.total_vehicle_days}</td><td><Badge warn>{r.status}</Badge></td>
                    <td><Link prefetch={false} className="button-link" href={'?' + q}>Open report</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {!history.total && <div className="empty">No saved reports for these filters.</div>}
          <Pagination total={history.total} offset={hoffset} base={hbase} param="hoffset" />
        </div>
      )}
    </>
  );
}
