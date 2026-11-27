import { notFound, redirect } from 'next/navigation';
import { getContext, homeFor, isRepairerOnly } from '@/lib/data';
import { checkedId } from '@/lib/ids';
import { getRepair, myRepairs } from '@/lib/repairs';
import { londonDateTime } from '@/lib/dates';
import { PageHeader, LinkButton } from '@/components/ui';
import { RepairView } from '@/components/RepairView';

// One job, for the repair shop it was passed to. The shop sees the vehicle and the damage, not the driver, injuries or the insurer's notes.
export default async function RepairJob({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!isRepairerOnly(ctx)) redirect(homeFor(ctx));
  let id: string;
  try { id = checkedId((await params).id); } catch { notFound(); }
  const [job] = await myRepairs(id);
  if (!job) notFound();
  const data = await getRepair(id);
  if (!data) notFound();
  return (
    <>
      <PageHeader crumb="REPAIRS" title={job.registration} subtitle={`${job.reference}${job.make_model ? ' · ' + job.make_model : ''} · ${job.fleet_name}`} actions={<LinkButton href="/repairs">← Repairs</LinkButton>} />
      <section className="panel"><div className="panel-body">
        <h2>The vehicle and the damage</h2>
        <p className="subtext">Passed to {job.repairer_name} on {londonDateTime(job.assigned_at)}</p>
        <dl className="facts">
          <div><dt>Incident</dt><dd>{londonDateTime(job.incident_at)} · {job.location}</dd></div>
          <div><dt>Driveable</dt><dd>{job.vehicle_driveable === null ? 'Not said' : job.vehicle_driveable ? 'Yes' : 'No'}</dd></div>
        </dl>
        <p className="preline">{job.description}</p>
      </div></section>
      <section className="panel"><div className="panel-body">
        <RepairView claim={id} data={data} viewer="repairer" claimOpen />
      </div></section>
    </>
  );
}
