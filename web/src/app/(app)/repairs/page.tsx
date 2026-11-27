import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, homeFor, isRepairerOnly } from '@/lib/data';
import { myRepairs, repairStatusLabel } from '@/lib/repairs';
import { gbp } from '@/lib/bordereau';
import { londonDateTime } from '@/lib/dates';
import { PageHeader, Badge, Notice } from '@/components/ui';

// A repair shop's list of vehicles passed to it by the insurer.
export default async function Repairs() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!isRepairerOnly(ctx)) redirect(homeFor(ctx));
  const jobs = await myRepairs();
  const waiting = jobs.filter(j => j.repair_status === 'with_repairer');
  return (
    <>
      <PageHeader crumb="REPAIRS" title="Repairs" subtitle={ctx.repairers?.map(r => r.name).join(', ') ?? ''} />
      <Notice>Vehicles the insurer has passed to you. Add photos of the damage, upload your quote and send it for approval. You can start the repair once the insurer approves it.</Notice>
      <section className="panel">
        <div className="panel-header"><h2>Your jobs</h2><Badge warn={waiting.length > 0}>{waiting.length} need your quote</Badge></div>
        {jobs.length === 0 ? <div className="panel-body"><p className="subtext">Nothing has been passed to you yet.</p></div> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Claim</th><th>Vehicle</th><th>Customer</th><th>Status</th><th>Quote</th><th>Updated</th></tr></thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.claim_id}>
                  <td><Link href={'/repairs/' + j.claim_id}>{j.reference}</Link></td>
                  <td><strong className="registration">{j.registration}</strong>{j.make_model && <small>{j.make_model}</small>}</td>
                  <td>{j.fleet_name}</td>
                  <td><Badge warn={j.repair_status === 'with_repairer' || j.repair_status === 'approved'}>{repairStatusLabel[j.repair_status]}</Badge></td>
                  <td>{j.quote_amount != null ? gbp(j.quote_amount) : '—'}</td>
                  <td>{londonDateTime(j.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
