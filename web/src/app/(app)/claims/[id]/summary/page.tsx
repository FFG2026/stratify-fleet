import { notFound, redirect } from 'next/navigation';
import { getContext, orgName } from '@/lib/data';
import { claimSide, getClaim } from '@/lib/claims-data';
import { checkedId } from '@/lib/ids';
import { eventTitle, originLabel, outcomeLabel, statusLabel, type ClaimStatus } from '@/lib/claims';
import { londonDate, londonDateTime } from '@/lib/dates';
import { itemProgress, itemState, itemTitle } from '@/lib/claim-items';
import { PageHeader, LinkButton } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';

const yn = (v: boolean | null) => (v === null ? 'Not said' : v ? 'Yes' : 'No');
const sideName = { driver: 'Driver', fleet: 'Fleet', insurer: 'Insurer' } as const;

// A plain, printable record of the claim for the insurer's own system or file. It shows what this side is allowed to see
// (private notes from the other side never reach this page), so it is safe to save as a PDF and attach elsewhere.
export default async function ClaimSummary({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const side = claimSide(ctx);
  if (!side || side === 'driver' || side === 'tpa' || ctx.demo) notFound();
  let id: string;
  try { id = checkedId((await params).id); } catch { notFound(); }
  const data = await getClaim(id).catch(() => null);
  if (!data) notFound();
  const { claim: c, parties, events, requests, files, items } = data;
  return (
    <>
      <PageHeader crumb="CLAIMS" title={`${c.reference} · summary`} subtitle={`${c.registration} · ${orgName(ctx, c.fleet_id)} · printed ${londonDateTime(new Date().toISOString())}`}
        actions={<><LinkButton href={'/claims/' + c.id}>← Back to the claim</LinkButton><PrintButton /></>} />
      <section className="panel"><div className="panel-body">
        <h2>Overview</h2>
        <dl className="details">
          <div><dt>Status</dt><dd>{statusLabel[c.status as ClaimStatus] ?? c.status}{c.outcome ? ` · ${outcomeLabel[c.outcome]}` : ''}</dd></div>
          {c.insurer_reference && <div><dt>Insurer reference</dt><dd>{c.insurer_reference}</dd></div>}
          <div><dt>Reported</dt><dd>{originLabel[c.origin]}</dd></div>
          <div><dt>When</dt><dd>{londonDateTime(c.incident_at)}</dd></div>
          <div><dt>Where</dt><dd>{c.location}</dd></div>
          <div><dt>Vehicle</dt><dd>{c.registration}</dd></div>
          <div><dt>Driver</dt><dd>{c.driver_name || 'Not recorded'}</dd></div>
          <div><dt>Anyone injured</dt><dd>{c.anyone_injured ? 'Yes' : 'No'}</dd></div>
          {c.anyone_injured && <div><dt>Injury details</dt><dd>{c.injury_details}</dd></div>}
          <div><dt>Police attended</dt><dd>{yn(c.police_attended)}{c.police_reference ? ` · ${c.police_reference}` : ''}</dd></div>
          <div><dt>Vehicle can be driven</dt><dd>{yn(c.vehicle_driveable)}</dd></div>
          <div><dt>Other party involved</dt><dd>{yn(c.third_party_involved)}</dd></div>
        </dl>
        <h3>Description</h3>
        <p className="preline">{c.description}</p>
      </div></section>
      {parties.length > 0 && (
        <section className="panel"><div className="panel-body">
          <h2>Other people involved</h2>
          <ul className="doclist">{parties.map(p => <li key={p.id}><strong>{p.name}</strong><span className="subtext"> · {p.kind === 'witness' ? 'Witness' : 'Other party'}{p.phone ? ` · ${p.phone}` : ''}{p.vehicle_registration ? ` · ${p.vehicle_registration}` : ''}{p.insurer_name ? ` · insured by ${p.insurer_name}` : ''}{p.injured ? ' · injured' : ''}{p.notes ? ` · ${p.notes}` : ''}</span></li>)}</ul>
        </div></section>
      )}
      {requests.length > 0 && (
        <section className="panel"><div className="panel-body">
          <h2>Requests</h2>
          <ul className="requests">
            {requests.map(r => {
              const its = items.filter(i => i.request_id === r.id);
              return (
                <li key={r.id}>
                  <p><strong>{r.question}</strong> · {r.cancelled_at ? 'Withdrawn' : r.answered_at ? 'Answered' : 'Waiting for the fleet'}</p>
                  <p className="subtext">Asked {londonDateTime(r.requested_at)}{r.due_on ? ` · needed by ${r.due_on.split('-').reverse().join('/')}` : ''}{r.reminder_count ? ` · reminded ${r.reminder_count} time${r.reminder_count === 1 ? '' : 's'}` : ''}</p>
                  {its.length > 0 && <ul className="item-list">{its.map(i => <li key={i.id} className="item-row"><strong>{itemTitle(i)}</strong> · {itemState(i) === 'received' ? 'Received' : itemState(i) === 'unavailable' ? `Not available${i.unavailable_reason ? ': ' + i.unavailable_reason : ''}` : 'Waiting'}</li>)}</ul>}
                  {its.length > 0 && <p className="subtext">{itemProgress(its).done} of {its.length} received</p>}
                  {r.answer && <p className="answer-text">{r.answer}</p>}
                </li>
              );
            })}
          </ul>
        </div></section>
      )}
      {files.length > 0 && (
        <section className="panel"><div className="panel-body">
          <h2>Photos and documents ({files.length})</h2>
          <div className="photo-grid">
            {files.map(f => (
              <figure key={f.id} className="photo">
                {f.kind === 'photo' ? <img src={`/claims/file/${f.id}`} alt={f.caption || f.file_name} /> : <span className="pdf">PDF</span>}
                <figcaption><span>{f.caption || f.file_name}</span><span className="subtext">{sideName[f.uploaded_side]} · {londonDate(f.uploaded_at).split('-').reverse().join('/')}</span></figcaption>
              </figure>
            ))}
          </div>
        </div></section>
      )}
      <section className="panel"><div className="panel-body">
        <h2>Timeline</h2>
        <ol className="timeline">
          {events.map(e => (
            <li key={e.id}>
              <div><strong>{eventTitle[e.kind] ?? e.kind}</strong> <span className="subtext">· {e.actor_label ?? sideName[e.side]} · {londonDateTime(e.created_at)}{e.visibility !== 'shared' ? ` · only ${e.visibility === 'fleet' ? 'the fleet' : 'the insurer'}` : ''}</span></div>
              {e.body && <p className="preline">{e.body}</p>}
            </li>
          ))}
        </ol>
      </div></section>
    </>
  );
}
