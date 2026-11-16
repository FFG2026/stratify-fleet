import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getContext, homeFor, isDriverOnly, isTpaOnly, orgName, canViewDrivers } from '@/lib/data';
import { vehicleDetail, ukDate } from '@/lib/vehicle-detail';
import { checkedId } from '@/lib/ids';
import { PageHeader, LinkButton, Badge, Notice, Stats, periodStatus } from '@/components/ui';

export default async function VehicleDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx) || isTpaOnly(ctx)) redirect(homeFor(ctx));
  const { id } = await params;
  try { checkedId(id); } catch { notFound(); }
  // Row-level security returns nothing for vehicles this person may not see; that looks the same as a missing vehicle.
  const data = ctx.demo ? null : await vehicleDetail(id).catch(() => null);
  if (!data) notFound();
  const { vehicle, periods, stints } = data;
  const current = periods.find(p => periodStatus(p, ctx.policies.find(x => x.id === p.policy_id)) === 'Covered');
  const policyRef = (policyId: string) => ctx.policies.find(p => p.id === policyId)?.reference ?? '';
  const driver = stints.find(s => s.status === 'current');
  const showName = (s: { name: string | null }) => s.name ?? 'Name not available to your role';
  return (
    <>
      <PageHeader title={vehicle.registration} subtitle={(vehicle.make_model || 'Vehicle') + ' · ' + orgName(ctx, vehicle.fleet_id)} actions={<LinkButton href="/fleet">← Vehicle register</LinkButton>} />
      <Stats compact items={[
        ['Cover status', current ? 'On cover' : 'Not on cover', current ? 'Cover started ' + ukDate(current.starts_on) : periods.length ? 'Last period ended ' + ukDate(periods[0].ends_on ?? periods[0].starts_on) : 'No cover recorded'],
        ['Policy', current ? policyRef(current.policy_id) : periods[0] ? policyRef(periods[0].policy_id) : '—', orgName(ctx, vehicle.fleet_id)],
        ['Current driver', driver ? showName(driver) : 'Nobody assigned', driver ? 'Since ' + ukDate(driver.from) : 'No driver is assigned today'],
        ['Drivers on record', stints.length, stints.length === 1 ? '1 assignment' : stints.length + ' assignments']
      ]} />
      <section className="panel">
        <div className="panel-header"><h2>Driver history</h2><span className="muted">Who has driven this vehicle, newest first</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Driver</th><th>From</th><th>To</th><th>Status</th></tr></thead>
          <tbody>{stints.map(s => (
            <tr key={s.id}>
              <td>{s.name && canViewDrivers(ctx) ? <Link prefetch={false} className="textbtn" href={'/drivers/' + s.user_id}><strong>{s.name}</strong></Link> : <strong>{showName(s)}</strong>}</td>
              <td>{ukDate(s.from)}</td><td>{s.to ? ukDate(s.to) : 'Ongoing'}</td>
              <td><Badge warn={s.status !== 'current'}>{s.status === 'current' ? 'Current driver' : s.status === 'upcoming' ? 'Starts later' : 'Previous driver'}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div>
        {!stints.length && <div className="empty">No driver has been assigned to this vehicle yet.</div>}
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Cover history</h2><span className="muted">Every period this vehicle has been on cover</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Policy</th><th>Start date</th><th>Removal date</th><th>Status</th></tr></thead>
          <tbody>{periods.map(p => {
            const status = periodStatus(p, ctx.policies.find(x => x.id === p.policy_id));
            return <tr key={p.id}><td>{policyRef(p.policy_id)}</td><td>{ukDate(p.starts_on)}</td><td>{p.ends_on ? ukDate(p.ends_on) : 'Open period'}</td><td><Badge warn={status !== 'Covered'}>{status}</Badge></td></tr>;
          })}</tbody>
        </table></div>
        {!periods.length && <div className="empty">No cover has been recorded for this vehicle.</div>}
      </section>
      <Notice>Driver names are shown only to roles allowed to see driver details. Driver history is built from the fleet&rsquo;s vehicle assignments; dates are calendar days.</Notice>
    </>
  );
}
