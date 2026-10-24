import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, canSearchNational } from '@/lib/data';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { nationalFile, type NationalFile, type NationalRecord } from '@/lib/national';
import { londonShortDate } from '@/lib/dates';

const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });
const money = (n: number | null) => (n == null ? '—' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2 }));

function Section({ title, rows, none, kind }: { title: string; rows: NationalRecord[]; none: string | null; kind: NationalRecord['kind'] }) {
  return (
    <section className="panel"><div className="panel-body">
      <div className="cardhead"><h2>{title}</h2></div>
      {!rows.length ? <div className="empty">{none ?? 'Nothing entered.'}</div> : (
        <div className="table-scroll"><table>
          <thead>{kind === 'employment' ? <tr><th>Employer</th><th>Job</th><th>From</th><th>To</th></tr>
            : kind === 'claim' ? <tr><th>What happened</th><th>Date</th><th>At fault</th><th>Cost</th><th>Notes</th></tr>
            : <tr><th>Offence</th><th>Date</th><th>Points</th><th>Penalty</th></tr>}</thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              {kind === 'employment' && <><td>{r.title}</td><td>{r.detail || '—'}</td><td>{day(r.start_date)}</td><td>{r.end_date ? day(r.end_date) : 'Current'}</td></>}
              {kind === 'claim' && <><td>{r.title}</td><td>{day(r.start_date)}</td><td>{r.at_fault === null ? '—' : r.at_fault ? 'Yes' : 'No'}</td><td>{money(r.amount)}</td><td>{r.detail || '—'}</td></>}
              {kind === 'conviction' && <><td>{r.title}</td><td>{day(r.start_date)}</td><td>{r.points ?? '—'}</td><td>{r.detail || '—'}</td></>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div></section>
  );
}

export default async function NationalDriver({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canSearchNational(ctx)) redirect('/drivers');
  const { id } = await params;
  let file: NationalFile | null = null, error = '';
  try { file = await nationalFile(id); } catch (e) { error = e instanceof Error ? e.message : 'Unable to open this driver.'; }
  return (
    <>
      <PageHeader title={file?.full_name ?? 'National driver database'} subtitle={file ? `Born ${file.date_of_birth ? day(file.date_of_birth) : '—'} · ${file.fleet_name ? `Currently with ${file.fleet_name}` : "Not currently with a customer"}` : 'Driver history'}
        actions={<Link prefetch={false} className="button-link" href="/drivers/national">← Search</Link>} />
      {error && <Notice alert>{error}</Notice>}
      {file && (
        <>
          <Notice>Entered by the driver, not verified. Shared with insurers by the driver&apos;s choice since {londonShortDate(file.shared_since)}. This view has been logged against your account.</Notice>
          <Section title="Job history" rows={file.records.filter(r => r.kind === 'employment')} none={null} kind="employment" />
          <Section title="Claims history" rows={file.records.filter(r => r.kind === 'claim')} none={file.no_claims_declared_at ? `Driver declared no claims on ${londonShortDate(file.no_claims_declared_at)}.` : 'Nothing entered, and the driver has not declared "no claims".'} kind="claim" />
          <Section title="Motoring convictions" rows={file.records.filter(r => r.kind === 'conviction')} none={file.no_convictions_declared_at ? `Driver declared no convictions on ${londonShortDate(file.no_convictions_declared_at)}.` : 'Nothing entered, and the driver has not declared "no convictions".'} kind="conviction" />
          <p className="subtext"><Badge warn>Not checked</Badge> The portal has not checked this against the DVLA, a claims database or any other source.</p>
        </>
      )}
    </>
  );
}
