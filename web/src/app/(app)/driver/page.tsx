import { redirect } from 'next/navigation';
import { getContext, getMyCover, homeFor, isDriverOnly, type DriverCoverRow } from '@/lib/data';
import { PageHeader, Notice, Stats, Badge } from '@/components/ui';
import { londonShortDate, today } from '@/lib/dates';

const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });

export default async function DriverDashboard() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!isDriverOnly(ctx)) redirect(homeFor(ctx));
  let rows: DriverCoverRow[] = [], error = '';
  try { rows = await getMyCover(); } catch (e) { error = e instanceof Error ? e.message : 'Unable to load your vehicles.'; }
  const now = Date.now(), t = today();
  // A line is "now" when the person still has the vehicle and the vehicle is covered at this moment.
  const current = (r: DriverCoverRow) => !!r.cover_start && Date.parse(r.cover_start) <= now && (!r.cover_end || Date.parse(r.cover_end) > now) && (!r.assigned_to || r.assigned_to >= t);
  const covered = rows.filter(current);
  const earlier = rows.filter(r => !current(r));
  const assignedNoCover = new Map<string, DriverCoverRow>();
  for (const r of earlier) if (!r.cover_start && (!r.assigned_to || r.assigned_to >= t)) assignedNoCover.set(r.assignment_id, r);
  const history = earlier.filter(r => r.cover_start || !assignedNoCover.has(r.assignment_id));
  const period = (r: DriverCoverRow) => r.cover_start ? `${londonShortDate(r.cover_start)} – ${r.cover_end ? londonShortDate(r.cover_end) : 'no end date'}` : 'Not on cover';
  return (
    <>
      <PageHeader title="Driver dashboard" subtitle="The vehicles you drive and when they are covered." />
      {error && <Notice alert>{error}</Notice>}
      <Stats items={[
        ['On cover now', covered.length, covered.length === 1 ? 'Vehicle' : 'Vehicles'],
        ['Previously on cover', history.length, 'Earlier cover periods']
      ]} />
      <section className="panel">
        <div className="panel-header"><div><h2>On cover now</h2><p className="subtext">Vehicles you have and that are covered today</p></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Vehicle</th><th>Make / model</th><th>Cover period</th><th>You have it from</th><th>Status</th></tr></thead>
          <tbody>
            {covered.map(r => (
              <tr key={r.assignment_id + (r.cover_start ?? '')}>
                <td><span className="registration">{r.registration}</span></td><td>{r.make_model || '—'}</td>
                <td>{period(r)}</td><td>{day(r.assigned_from)}</td><td><Badge>Covered</Badge></td>
              </tr>
            ))}
            {[...assignedNoCover.values()].map(r => (
              <tr key={r.assignment_id}>
                <td><span className="registration">{r.registration}</span></td><td>{r.make_model || '—'}</td>
                <td>—</td><td>{day(r.assigned_from)}</td><td><Badge warn>Not on cover today</Badge></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!covered.length && !assignedNoCover.size && <div className="empty">No vehicle is assigned to you yet. Your fleet administrator assigns vehicles to drivers.</div>}
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>Previously on cover</h2><p className="subtext">Vehicles and cover periods that have ended</p></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Vehicle</th><th>Make / model</th><th>Cover period</th><th>You had it</th></tr></thead>
          <tbody>
            {history.map(r => (
              <tr key={r.assignment_id + (r.cover_start ?? '') + (r.cover_end ?? '')}>
                <td><span className="registration">{r.registration}</span></td><td>{r.make_model || '—'}</td>
                <td>{period(r)}</td><td>{day(r.assigned_from)} – {r.assigned_to ? day(r.assigned_to) : 'now'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!history.length && <div className="empty">Nothing here yet.</div>}
      </section>
    </>
  );
}
