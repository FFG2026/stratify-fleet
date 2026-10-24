import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, getMembers, getAssignments, getDriverFile, listDrivers, canChange, canViewDrivers, isDriverOnly, type Assignment } from '@/lib/data';
import { PageHeader, Notice, Badge, Pagination } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { AssignDriverForm, EndAssignmentButton } from '@/components/DriverControls';
import { DriverSearch } from '@/components/DriverSearch';
import { ProfileForm } from '@/components/DriverForms';
import { Checklist, Documents, History, Permissions, LicenceCheckDriver } from '@/components/DriverFile';
import { completeness, historyGaps } from '@/lib/drivers';
import { today } from '@/lib/dates';
import Planned from '../[module]/page';

type SP = { org?: string; fleet?: string; q?: string; offset?: string; view?: string };
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });

export default async function Drivers({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const sp = await searchParams;
  if (ctx.demo || (!isDriverOnly(ctx) && !canViewDrivers(ctx))) return Planned({ params: Promise.resolve({ module: 'drivers' }) });
  if (isDriverOnly(ctx)) return <MyFile ctx={ctx} />;
  return <Directory ctx={ctx} sp={sp} />;
}

async function MyFile({ ctx }: { ctx: NonNullable<Awaited<ReturnType<typeof getContext>>> }) {
  let file = null, error = '';
  try { file = await getDriverFile(ctx.user.id); } catch (e) { error = e instanceof Error ? e.message : 'Unable to load your file.'; }
  return (
    <>
      <PageHeader title="Drivers & licences" subtitle="Your details, documents, permissions and history." />
      <Notice><strong>Who sees this.</strong> Everything on this page is visible to your fleet and to the insurers of that fleet, and to nobody else. You can remove documents and withdraw permissions at any time.</Notice>
      {error && <Notice alert>{error}</Notice>}
      {file && (
        <>
          <Checklist file={file} />
          <section className="panel"><div className="panel-body"><div className="cardhead"><h2>Your details</h2></div><ProfileForm profile={file.profile} email={ctx.user.email} /></div></section>
          {file.profile
            ? <><Documents file={file} editable /><Permissions file={file} editable /><LicenceCheckDriver file={file} /><History file={file} editable /></>
            : <Notice>Save your details first. Then you can upload documents, give permissions and add your history.</Notice>}
        </>
      )}
    </>
  );
}

async function Directory({ ctx, sp }: { ctx: NonNullable<Awaited<ReturnType<typeof getContext>>>; sp: SP }) {
  const fleets = ctx.orgs.filter(o => o.kind === 'customer');
  const assignView = sp.view === 'assignments' && canChange(ctx);
  const header = <PageHeader title="Drivers & licences" subtitle="Driver details, documents, permissions and history." />;
  const tabs = canChange(ctx) && (
    <div className="tabs-row">
      <Link prefetch={false} className={'button-link' + (assignView ? '' : ' primary')} href="/drivers">Drivers</Link>
      <Link prefetch={false} className={'button-link' + (assignView ? ' primary' : '')} href="/drivers?view=assignments">Vehicle assignments</Link>
    </div>
  );
  if (assignView) return <>{header}{tabs}<Assignments ctx={ctx} org={sp.org} fleets={fleets} /></>;

  const fleet = fleets.some(f => f.id === sp.fleet) ? sp.fleet! : '';
  const offset = Math.max(0, Number(sp.offset) || 0), q = (sp.q ?? '').slice(0, 60);
  let data = { rows: [] as Awaited<ReturnType<typeof listDrivers>>['rows'], total: 0 }, error = '';
  try { data = await listDrivers({ q, fleet: fleet || undefined, offset }); } catch (e) { error = e instanceof Error ? e.message : 'Unable to load drivers.'; }
  const base = new URLSearchParams(); if (q) base.set('q', q); if (fleet) base.set('fleet', fleet);
  const t = today();
  return (
    <>
      {header}
      {tabs}
      <Notice>Documents and history are provided by the drivers themselves. Opening a document is recorded in the audit trail. Recording a licence-check permission is not a licence check: the portal does not check licences with the DVLA yet.</Notice>
      <div className="filters">
        <DriverSearch initial={q} fleet={fleet} />
        {fleets.length > 1 && <ParamSelect name="fleet" label="Fleet" value={fleet} options={[{ value: '', label: 'All fleets' }, ...fleets.map(o => ({ value: o.id, label: o.name }))]} />}
      </div>
      {error && <Notice alert>{error}</Notice>}
      <section className="panel">
        <div className="table-scroll"><table>
          <thead><tr><th>Driver</th><th>Fleet</th><th>Licence photos</th><th>Right to work</th><th>Licence check permission</th><th>Last licence check</th><th>Job history</th><th>Claims</th><th>Convictions</th><th>File</th></tr></thead>
          <tbody>
            {data.rows.map(r => {
              const items = completeness({ profile: r, docKinds: r.docKinds, licenceCheck: r.licenceCheck, dataSharing: r.dataSharing, jobs: r.jobs, claims: r.claims, convictions: r.convictions }, t);
              const done = items.filter(i => i.done).length;
              const gaps = r.jobs.length ? historyGaps(r.jobs, t).length : -1;
              return (
                <tr key={r.user_id}>
                  <td><Link prefetch={false} className="textbtn" href={'/drivers/' + r.user_id}><strong>{r.full_name}</strong></Link></td>
                  <td>{ctx.orgs.find(o => o.id === r.fleet_id)?.name ?? '—'}</td>
                  <td>{r.docKinds.includes('licence_front') && r.docKinds.includes('licence_back') ? <Badge>Uploaded</Badge> : <Badge warn>Missing</Badge>}</td>
                  <td>{r.docKinds.includes('right_to_work') ? <Badge>Uploaded</Badge> : <Badge warn>Missing</Badge>}</td>
                  <td>{r.licenceCheck ? <Badge>Given</Badge> : <Badge warn>Not given</Badge>}</td>
                  <td>{r.lastCheck ? <>{r.lastCheck.status === 'valid' ? <Badge>Valid</Badge> : <Badge warn>{r.lastCheck.status === 'not_valid' ? 'Not valid' : 'Could not check'}</Badge>} <span className="subtext">{new Date(r.lastCheck.checked_at).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}</span></> : <Badge warn>Never</Badge>}</td>
                  <td>{gaps === -1 ? <Badge warn>None</Badge> : gaps === 0 ? <Badge>3 years</Badge> : <Badge warn>Gaps</Badge>}</td>
                  <td>{r.claims || (r.no_claims_declared_at ? 'None' : '—')}</td><td>{r.convictions || (r.no_convictions_declared_at ? 'None' : '—')}</td>
                  <td>{done} / {items.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!data.rows.length && <div className="empty">{q ? 'No drivers match that name.' : 'No drivers have saved their details yet.'}</div>}
        <Pagination total={data.total} offset={offset} base={base} />
      </section>
    </>
  );
}

async function Assignments({ ctx, org, fleets }: { ctx: NonNullable<Awaited<ReturnType<typeof getContext>>>; org?: string; fleets: { id: string; name: string }[] }) {
  const current = fleets.find(o => o.id === org) ?? fleets[0];
  if (!current) return <Notice>No fleets are available to manage.</Notice>;
  let drivers: { id: string; email: string }[] = [], assignments: Assignment[] = [], error = '';
  try {
    const members = await getMembers(current.id);
    drivers = members.filter(m => m.role === 'driver' && m.active && !m.pending && m.user_id).map(m => ({ id: m.user_id as string, email: m.email }));
    assignments = await getAssignments(current.id);
  } catch (e) { error = e instanceof Error ? e.message : 'Unable to load drivers.'; }
  const email = (id: string) => drivers.find(d => d.id === id)?.email ?? 'Former driver';
  void ctx;
  return (
    <>
      {fleets.length > 1 && <div className="filters"><ParamSelect name="org" label="Fleet" value={current.id} resetParams={[]} options={fleets.map(o => ({ value: o.id, label: o.name }))} /></div>}
      {error && <Notice alert>{error}</Notice>}
      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Assign a driver to a vehicle</h2></div>
        <AssignDriverForm org={current.id} drivers={drivers} today={today()} />
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
