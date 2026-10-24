import { redirect } from 'next/navigation';
import { getContext, canViewIntegrations } from '@/lib/data';
import { countRows } from '@/lib/rest';
import { PageHeader, Notice, Badge, fmt } from '@/components/ui';

const statuses: [string, string][] = [['not_submitted', 'Not submitted'], ['queued', 'Queued'], ['submitted', 'Submitted'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['error', 'Error']];

export default async function Integrations() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canViewIntegrations(ctx)) redirect('/');
  const counts = await Promise.all(statuses.map(([s]) => countRows('mipd_submissions', 'submission_status=eq.' + s)));
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="MID / MIB status" subtitle="Whether cover records are being sent to the Motor Insurance Database." />
      <Notice alert>The portal is <strong>not connected</strong> to the Motor Insurance Database or the MIB. Nothing below has been sent. Records are prepared and queued so that a future connection can send them.</Notice>
      <section className="panel">
        <div className="panel-header"><h2>Connection</h2><Badge warn>Not connected</Badge></div>
        <div className="panel-body">
          <p>Cover in this portal and a submission to the database are two separate things. A vehicle is covered when its cover period says so. A submission only records whether that cover has been reported. <strong>A submission, even a successful one, does not confirm or create cover.</strong></p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Prepared records</h2><span className="muted">{fmt(total)} in total</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Submission status</th><th>Records</th></tr></thead>
          <tbody>{statuses.map(([s, label], i) => <tr key={s}><td>{label}</td><td>{fmt(counts[i])}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}
