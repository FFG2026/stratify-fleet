import { redirect } from 'next/navigation';
import { getContext } from '@/lib/data';
import { PageHeader, Notice, Badge, Stats, LinkButton, fmt } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { TelematicsImport } from '@/components/TelematicsImport';
import { telematicsView, getFleetTelematics, getInsurerTelematics, type Totals } from '@/lib/telematics-data';
import { bandLabel, kindLabel, scoreBand, telematicsNotConnected } from '@/lib/telematics';
import { londonDateTime } from '@/lib/dates';

type SP = { fleet?: string; days?: string };
const periods = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']] as const;

const Score = ({ score }: { score: number | null }) => { const b = scoreBand(score); return <><strong>{score ?? '—'}</strong> <Badge warn={b === 'watch' || b === 'high'}>{bandLabel[b]}</Badge></>; };

export default async function Telematics({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const sp = await searchParams;
  const view = telematicsView(ctx);
  const head = <PageHeader title="Telematics" subtitle="Vehicle and driver risk scores, harsh-driving and speeding events, and crash alerts." />;
  if (!view) return <>{head}<Notice>{ctx.demo ? 'Telematics is not available in the demonstration workspace.' : 'Your role cannot see telematics.'}</Notice></>;

  const fleets = ctx.orgs.filter(o => o.kind === 'customer');
  const fleet = fleets.find(f => f.id === sp.fleet) ?? fleets[0];
  const days = periods.some(p => p[0] === sp.days) ? Number(sp.days) : 90;
  if (!fleet) return <>{head}<Notice>There is no fleet to show.</Notice></>;
  const picker = (
    <div className="filters">
      {fleets.length > 1 && <ParamSelect name="fleet" label="Fleet" value={fleet.id} options={fleets.map(f => ({ value: f.id, label: f.name }))} />}
      <ParamSelect name="days" label="Period" value={String(days)} options={periods.map(p => ({ value: p[0], label: p[1] }))} />
    </div>
  );

  let error = '';
  let vehicles: Totals[] = []; let data: Awaited<ReturnType<typeof getFleetTelematics>> | null = null;
  try {
    if (view === 'fleet') { data = await getFleetTelematics(fleet.id, days); vehicles = data.perVehicle; }
    else vehicles = await getInsurerTelematics(fleet.id, days);
  } catch (e) { error = e instanceof Error ? e.message : 'Unable to load telematics.'; }
  vehicles = [...vehicles].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  const miles = vehicles.reduce((s, v) => s + v.miles, 0);
  const crashes = vehicles.reduce((s, v) => s + v.crash_alerts, 0);
  const events = vehicles.reduce((s, v) => s + v.harsh_braking + v.harsh_acceleration + v.harsh_cornering + v.speeding, 0);

  return (
    <>
      {head}
      {picker}
      {error && <Notice alert>{error}</Notice>}
      {!error && vehicles.length === 0 && <Notice>{telematicsNotConnected}</Notice>}
      {vehicles.length > 0 && <>
        <Stats items={[['Vehicles with data', vehicles.length, ''], ['Miles', fmt(Math.round(miles)), ''], ['Driving events', fmt(events), ''], ['Crash alerts', crashes, crashes ? 'Check on the driver' : '']]} />
        <Notice>The score is out of 100 (100 is best): 2 points off for each weighted event per 100 miles. Speeding counts double and severity multiplies. It needs at least 50 miles to show. It is a simple guide for this fleet, not an underwriting rating.{view === 'insurer' ? ' You see vehicle totals only; drivers are not named.' : ''}</Notice>
      </>}
      {data && data.crashes.length > 0 && (
        <section className="panel"><div className="panel-body"><div className="cardhead"><h2>Crash alerts</h2><LinkButton href="/claims/new" primary>Report a claim</LinkButton></div>
          <div className="table-scroll"><table><thead><tr><th>When</th><th>Vehicle</th><th>Driver</th><th>Where</th></tr></thead><tbody>
            {data.crashes.map(c => <tr key={c.id}><td>{londonDateTime(c.occurred_at)}</td><td><span className="registration">{c.registration}</span></td><td>{c.driver ?? '—'}</td><td>{c.location ?? '—'}</td></tr>)}
          </tbody></table></div></div></section>
      )}
      {vehicles.length > 0 && (
        <section className="panel"><div className="panel-body"><div className="cardhead"><h2>Vehicles</h2></div>
          <div className="table-scroll"><table><thead><tr><th>Vehicle</th><th>Score</th><th>Miles</th><th>Braking</th><th>Accel.</th><th>Cornering</th><th>Speeding</th><th>Crash</th></tr></thead><tbody>
            {vehicles.map(v => <tr key={v.registration}><td><span className="registration">{v.registration}</span></td><td><Score score={v.score} /></td><td>{fmt(Math.round(v.miles))}</td><td>{v.harsh_braking}</td><td>{v.harsh_acceleration}</td><td>{v.harsh_cornering}</td><td>{v.speeding}</td><td>{v.crash_alerts || '—'}</td></tr>)}
          </tbody></table></div></div></section>
      )}
      {data && data.perDriver.length > 0 && (
        <section className="panel"><div className="panel-body"><div className="cardhead"><h2>Drivers</h2></div>
          <p className="subtext">Matched from vehicle assignments. Visible to your fleet only; your insurer sees vehicle totals, not driver names. Tell drivers that telematics is in use and how the data is used.</p>
          <div className="table-scroll"><table><thead><tr><th>Driver</th><th>Score</th><th>Miles</th><th>Weighted events</th></tr></thead><tbody>
            {[...data.perDriver].sort((a, b) => (a.score ?? 101) - (b.score ?? 101)).map(d => <tr key={d.driver_id ?? 'none'}><td>{d.name}</td><td><Score score={d.score} /></td><td>{fmt(Math.round(d.miles))}</td><td>{d.points}</td></tr>)}
          </tbody></table></div></div></section>
      )}
      {data && data.recent.length > 0 && (
        <section className="panel"><div className="panel-body"><div className="cardhead"><h2>Latest events</h2></div>
          <div className="table-scroll"><table><thead><tr><th>When</th><th>Vehicle</th><th>Driver</th><th>Event</th><th>Detail</th></tr></thead><tbody>
            {data.recent.map(e => <tr key={e.id}><td>{londonDateTime(e.occurred_at)}</td><td><span className="registration">{e.registration}</span></td><td>{e.driver ?? '—'}</td><td>{kindLabel[e.kind]} · severity {e.severity}</td>
              <td>{e.speed_mph != null ? `${e.speed_mph} mph${e.limit_mph != null ? ` in a ${e.limit_mph}` : ''}` : e.location ?? '—'}</td></tr>)}
          </tbody></table></div></div></section>
      )}
      {view === 'fleet' && (
        <section className="panel"><div className="panel-body"><div className="cardhead"><h2>Upload telematics data</h2></div>
          <p className="subtext">{telematicsNotConnected} Each row is a trip (with miles) or an event. Rows already uploaded are skipped, and a file with any problem is rejected whole, with the line to fix.</p>
          <p className="subtext">Drivers are entitled to know they are being monitored. Complete a data protection impact assessment before relying on driver-level scores.</p>
          <TelematicsImport fleet={fleet.id} />
        </div></section>
      )}
    </>
  );
}
