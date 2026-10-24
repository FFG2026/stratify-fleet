import { redirect } from 'next/navigation';
import { getContext, getMembers, getAssignments, canChange, isDriverOnly, type Assignment } from '@/lib/data';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { AssignDriverForm, EndAssignmentButton } from '@/components/DriverControls';
import { today } from '@/lib/dates';
import Planned from '../[module]/page';

const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });

export default async function Drivers({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  // Drivers see the roadmap page (licence records are not built yet); fleet staff assign drivers to vehicles.
  if (isDriverOnly(ctx) || ctx.demo || !canChange(ctx)) return Planned({ params: Promise.resolve({ module: 'drivers' }) });
  const fleets = ctx.orgs.filter(o => o.kind === 'customer');
  const { org } = await searchParams;
  const current = fleets.find(o => o.id === org) ?? fleets[0];
  const header = <PageHeader title="Drivers & licences" subtitle="Who drives which vehicle. Licence records are planned." />;
  if (!current) return (<>{header}<Notice>No fleets are available to manage.</Notice></>);
  let drivers: { id: string; email: string }[] = [], assignments: Assignment[] = [], error = '';
  try {
    const members = await getMembers(current.id);
    drivers = members.filter(m => m.role === 'driver' && m.active && !m.pending && m.user_id).map(m => ({ id: m.user_id as string, email: m.email }));
    assignments = await getAssignments(current.id);
  } catch (e) { error = e instanceof Error ? e.message : 'Unable to load drivers.'; }
  const email = (id: string) => drivers.find(d => d.id === id)?.email ?? 'Former driver';
  const t = today();
  return (
    <>
      {header}
      {fleets.length > 1 && <div className="filters"><ParamSelect name="org" label="Fleet" value={current.id} resetParams={[]} options={fleets.map(o => ({ value: o.id, label: o.name }))} /></div>}
      {error && <Notice alert>{error}</Notice>}
      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Assign a driver to a vehicle</h2></div>
        <AssignDriverForm org={current.id} drivers={drivers} today={t} />
        {!drivers.length && <p className="form-note">No active drivers yet. Add one on the Users page with the Driver role.</p>}
      </div></section>
      <section className="panel">
        <div className="panel-header"><div><h2>Assignments</h2><p className="subtext">Drivers see only the vehicles listed here</p></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Driver</th><th>Vehicle</th><th>From</th><th>Until</th><th></th></tr></thead>
          <tbody>
            {assignments.map(a => (
              <tr key={a.id}>
                <td>{email(a.user_id)}</td><td><span className="registration">{a.vehicle?.registration ?? '—'}</span></td>
                <td>{day(a.assigned_from)}</td><td>{a.assigned_to ? day(a.assigned_to) : <Badge>Current</Badge>}</td>
                <td>{!a.assigned_to && <EndAssignmentButton id={a.id} label={`End assignment of ${a.vehicle?.registration ?? 'vehicle'} for ${email(a.user_id)}`} />}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!assignments.length && <div className="empty">No vehicles are assigned to drivers yet.</div>}
      </section>
    </>
  );
}
