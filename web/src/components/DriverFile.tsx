import type { DriverFile, DriverRecord } from '@/lib/data';
import { Badge } from '@/components/ui';
import { RemoveButton, ConsentBox, DeclareNone, RecordForm, UploadForm } from '@/components/DriverForms';
import { consents, documentKinds, historyGaps, completeness } from '@/lib/drivers';
import { londonShortDate, today } from '@/lib/dates';

const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });
const money = (n: number | null) => (n === null ? '—' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const size = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

export function Checklist({ file }: { file: DriverFile }) {
  const items = completeness({
    profile: file.profile, docKinds: file.docs.map(d => d.kind), licenceCheck: file.consents.some(c => c.kind === 'licence_check' && c.given),
    dataSharing: file.consents.some(c => c.kind === 'data_sharing' && c.given), jobs: file.records.filter(r => r.kind === 'employment'),
    claims: file.records.filter(r => r.kind === 'claim').length, convictions: file.records.filter(r => r.kind === 'conviction').length
  }, today());
  const done = items.filter(i => i.done).length;
  return (
    <section className="panel"><div className="panel-body">
      <div className="cardhead"><h2>Your file</h2><Badge warn={done < items.length}>{done} of {items.length} complete</Badge></div>
      <ul className="checklist">{items.map(i => <li key={i.label} className={i.done ? 'done' : ''}><span aria-hidden="true">{i.done ? '✓' : '○'}</span> {i.label}<span className="sr-only">{i.done ? ' (done)' : ' (to do)'}</span></li>)}</ul>
    </div></section>
  );
}

function DocList({ file, kind, editable }: { file: DriverFile; kind: string; editable: boolean }) {
  const docs = file.docs.filter(d => d.kind === kind);
  if (!docs.length) return <p className="subtext">Nothing uploaded yet.</p>;
  return (
    <ul className="doclist">
      {docs.map(d => (
        <li key={d.id}>
          <a href={`/drivers/file/${d.id}`} target="_blank" rel="noopener noreferrer">{d.file_name}</a>
          <span className="subtext"> · {size(d.size_bytes)} · uploaded {londonShortDate(d.uploaded_at)}{d.expires_on ? ` · expires ${day(d.expires_on)}` : ''}</span>
          {editable && <RemoveButton kind="document" id={d.id} label={`Remove ${d.file_name}`} />}
        </li>
      ))}
    </ul>
  );
}

export function Documents({ file, editable }: { file: DriverFile; editable: boolean }) {
  return (
    <section className="panel"><div className="panel-body">
      <div className="cardhead"><h2>Documents</h2></div>
      <p className="subtext">{editable ? 'Photos (JPG, PNG, WebP) or PDF, up to 4 MB each. Only you, your fleet and its insurers can open them.' : 'Opening a document is recorded in the audit trail.'}</p>
      <div className="doc-grid">
        {documentKinds.map(k => (
          <div key={k.kind} className="doc-card">
            {editable ? <UploadForm kind={k.kind} label={k.label} hint={k.hint} withExpiry={k.kind === 'right_to_work' || k.kind === 'licence_front'} /> : <div><strong>{k.label}</strong></div>}
            <DocList file={file} kind={k.kind} editable={editable} />
          </div>
        ))}
      </div>
    </div></section>
  );
}

export function Permissions({ file, editable }: { file: DriverFile; editable: boolean }) {
  return (
    <section className="panel"><div className="panel-body">
      <div className="cardhead"><h2>Permissions</h2></div>
      {(Object.keys(consents) as (keyof typeof consents)[]).map(k => {
        const c = file.consents.find(x => x.kind === k);
        const given = !!c?.given, when = c ? londonShortDate(c.recorded_at) : null;
        return editable
          ? <ConsentBox key={k} kind={k} label={consents[k].label} statement={consents[k].statement} given={given} when={given ? when : null} />
          : (
            <div key={k} className="consent">
              <p><strong>{consents[k].label}:</strong> {given ? <Badge>Given {when}</Badge> : c ? <Badge warn>Withdrawn {when}</Badge> : <Badge warn>Not given</Badge>}</p>
              <p className="subtext">{consents[k].statement}</p>
            </div>
          );
      })}
      {!editable && <p className="subtext">Recording a permission is not a licence check. The portal does not check licences with the DVLA yet.</p>}
    </div></section>
  );
}

function Rows({ rows, kind, editable }: { rows: DriverRecord[]; kind: DriverRecord['kind']; editable: boolean }) {
  if (!rows.length) return <div className="empty">Nothing recorded.</div>;
  return (
    <div className="table-scroll"><table>
      <thead>{kind === 'employment' ? <tr><th>Employer</th><th>Job</th><th>From</th><th>To</th><th></th></tr>
        : kind === 'claim' ? <tr><th>What happened</th><th>Date</th><th>At fault</th><th>Cost</th><th>Notes</th><th></th></tr>
        : <tr><th>Offence</th><th>Date</th><th>Points</th><th>Penalty</th><th></th></tr>}</thead>
      <tbody>{rows.map(r => (
        <tr key={r.id}>
          {kind === 'employment' && <><td>{r.title}</td><td>{r.detail || '—'}</td><td>{day(r.start_date)}</td><td>{r.end_date ? day(r.end_date) : 'Current'}</td></>}
          {kind === 'claim' && <><td>{r.title}</td><td>{day(r.start_date)}</td><td>{r.at_fault === null ? '—' : r.at_fault ? 'Yes' : 'No'}</td><td>{money(r.amount)}</td><td>{r.detail || '—'}</td></>}
          {kind === 'conviction' && <><td>{r.title}</td><td>{day(r.start_date)}</td><td>{r.points ?? '—'}</td><td>{r.detail || '—'}</td></>}
          <td>{editable && <RemoveButton kind="record" id={r.id} label={`Remove ${r.title}`} />}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export function History({ file, editable }: { file: DriverFile; editable: boolean }) {
  const jobs = file.records.filter(r => r.kind === 'employment'), claims = file.records.filter(r => r.kind === 'claim'), convictions = file.records.filter(r => r.kind === 'conviction');
  const gaps = historyGaps(jobs, today());
  const nil = (at: string | null | undefined) => (at ? `Declared none on ${londonShortDate(at)}` : null);
  return (
    <>
      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Job history, last 3 years</h2>{jobs.length ? (gaps.length ? <Badge warn>Gaps found</Badge> : <Badge>Covers 3 years</Badge>) : <Badge warn>Not started</Badge>}</div>
        {gaps.length > 0 && jobs.length > 0 && <p className="subtext">Not covered: {gaps.map(g => `${day(g.from)} to ${day(g.to)}`).join('; ')}. Include self-employment, study or time out of work.</p>}
        <Rows rows={jobs} kind="employment" editable={editable} />
        {editable && <RecordForm kind="employment" />}
      </div></section>
      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Claims history</h2>{claims.length ? <Badge warn>{claims.length} recorded</Badge> : nil(file.profile?.no_claims_declared_at) ? <Badge>No claims declared</Badge> : <Badge warn>Not declared</Badge>}</div>
        <p className="subtext">Accidents or claims in the last five years, whoever was at fault. Claims made through this portal will be added here later.</p>
        <Rows rows={claims} kind="claim" editable={editable} />
        {!claims.length && nil(file.profile?.no_claims_declared_at) && <p className="subtext">{nil(file.profile?.no_claims_declared_at)}.</p>}
        {editable && <>{!claims.length && !file.profile?.no_claims_declared_at && file.profile && <DeclareNone kind="claims" label="I have had no claims in the last five years" />}<RecordForm kind="claim" /></>}
      </div></section>
      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Motoring convictions</h2>{convictions.length ? <Badge warn>{convictions.length} recorded</Badge> : nil(file.profile?.no_convictions_declared_at) ? <Badge>None declared</Badge> : <Badge warn>Not declared</Badge>}</div>
        <Rows rows={convictions} kind="conviction" editable={editable} />
        {!convictions.length && nil(file.profile?.no_convictions_declared_at) && <p className="subtext">{nil(file.profile?.no_convictions_declared_at)}.</p>}
        {editable && <>{!convictions.length && !file.profile?.no_convictions_declared_at && file.profile && <DeclareNone kind="convictions" label="I have no motoring convictions or penalty points" />}<RecordForm kind="conviction" /></>}
      </div></section>
    </>
  );
}
