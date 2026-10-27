import { notFound, redirect } from 'next/navigation';
import { getContext, orgName } from '@/lib/data';
import { claimSide, getClaim, getCoverRecord, getCueSubmissions } from '@/lib/claims-data';
import { checkedId } from '@/lib/ids';
import { claimGaps, eventTitle, originLabel, outcomeLabel, statusLabel, type ClaimStatus } from '@/lib/claims';
import { londonDate, londonDateTime } from '@/lib/dates';
import { PageHeader, Badge, Notice, LinkButton } from '@/components/ui';
import { itemProgress, itemTitle, type RequestItem } from '@/lib/claim-items';
import { AnswerForm, ItemBadge, ItemChecklist, RequestItemsForm, AssignForm, ClaimForm, CuePanel, InsurerPanel, NoteForm, PartyForm, PhotoUploader, RemoveFile, RemoveParty, ReviewPanel, WithdrawQuestion } from '@/components/ClaimForms';
import { ClockList } from '@/components/InboxViews';
import { inboxFromClaim, listClaimHandlers } from '@/lib/claims-data';
import { demoClaimNote, demoFleetLabel, demoInboxClaims, demoPriyaEmail, demoPriyaId, isDemoInboxClaim } from '@/lib/demo-inbox';
import { handlerLabel } from '@/lib/inbox';

const yn = (v: boolean | null) => (v === null ? 'Not said' : v ? 'Yes' : 'No');
const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const size = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const sideName = { driver: 'Driver', fleet: 'Fleet', insurer: 'Insurer' } as const;

export default async function ClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ upload?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const side = claimSide(ctx);
  if (!side) notFound();
  let id: string;
  try { id = checkedId((await params).id); } catch { notFound(); }
  if (ctx.demo || (side === 'insurer' && isDemoInboxClaim(id))) return <DemoClaim ctx={ctx} id={id} />;
  const data = await getClaim(id).catch(() => null);
  if (!data) notFound();
  const { claim: c, parties, events, requests, files, items } = data;
  const itemsOf = (rid: string): RequestItem[] => items.filter(i => i.request_id === rid);
  const sp = await searchParams;
  const me = ctx.user.id;
  const status = c.status as ClaimStatus;
  const open = status !== 'closed';
  const policy = ctx.policies.find(p => p.id === c.policy_id);
  const thirdParties = parties.filter(p => p.kind === 'third_party').length;
  const gaps = claimGaps(c, thirdParties, files.length);
  const canEdit = status === 'reported' && (side === 'fleet' || side === 'driver');
  const canAttach = open && (side === 'fleet' || side === 'insurer' || (side === 'driver' && status === 'reported'));
  const canParty = open && (side === 'fleet' || (side === 'driver' && status === 'reported'));
  const openRequests = requests.filter(r => !r.answered_at && !r.cancelled_at);
  const fleetName = orgName(ctx, c.fleet_id);
  const cover = await getCoverRecord(c.vehicle_id, c.incident_at).catch(() => null);
  // CUE is the insurer's own claims-history contribution; the fleet and driver never see it. null means the CUE table is unavailable, so the panel is hidden.
  const cue = side === 'insurer' && c.submitted_at ? await getCueSubmissions(c.id).catch(() => null) : null;
  const inbox = side === 'insurer' && c.submitted_at ? inboxFromClaim(c, requests, !!cover?.after) : null;
  const handlers = inbox ? await listClaimHandlers(c.id) : [];
  return (
    <>
      <PageHeader crumb="CLAIMS" title={c.reference} subtitle={`${c.registration} · ${fleetName}`} actions={<LinkButton href="/claims">← Claims</LinkButton>} />
      {cover?.after && side !== 'driver' && <Notice alert><strong>Cover was recorded after the incident.</strong> {cover.startedAt ? `This vehicle's cover was added to the portal on ${londonDateTime(cover.recordedAt)}, after the incident at ${londonDateTime(c.incident_at)}.` : `This vehicle had no cover in the portal at the time of the incident. It was added later, on ${londonDateTime(cover.recordedAt)}.`} The insurer decides whether the claim is accepted.</Notice>}
      {sp.upload === 'failed' && <Notice alert>Your claim was saved, but some photos could not be uploaded. Add them below.</Notice>}
      <div className="claim-status">
        <Badge warn={open}>{statusLabel[status] ?? status}</Badge>
        <span>{originLabel[c.origin]}</span>
        {c.anyone_injured && <Badge warn>Injury reported</Badge>}
        {c.insurer_reference && <span>Insurer reference <strong>{c.insurer_reference}</strong></span>}
        {c.outcome && <span>Outcome: <strong>{outcomeLabel[c.outcome]}</strong></span>}
      </div>

      {side === 'fleet' && status === 'reported' && (
        <section className="panel next-step"><div className="panel-body">
          <h2>Review and send to the insurer</h2>
          <p className="subtext">Check the details and photos below. When you mark the claim as reviewed you can send it with one button. Sending locks the details.</p>
          <ReviewPanel claim={c.id} gaps={gaps} assessed={!!c.assessed_at} notes={c.assessment_notes ?? ''} fileCount={files.length} />
        </div></section>
      )}
      {side === 'fleet' && openRequests.length > 0 && (
        <section className="panel next-step"><div className="panel-body">
          <h2>The insurer needs more information</h2>
          {openRequests.map(r => (
            <div key={r.id} className="request open">
              <p><strong>{r.question}</strong></p>
              <p className="subtext">Asked {londonDateTime(r.requested_at)}{r.due_on ? ` · needed by ${new Date(r.due_on + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' })}` : ''}</p>
              {itemsOf(r.id).length > 0 ? <ItemChecklist claim={c.id} request={r.id} items={itemsOf(r.id)} /> : <AnswerForm claim={c.id} request={r.id} />}
            </div>
          ))}
        </div></section>
      )}
      {side === 'driver' && (
        <Notice>{status === 'reported' ? 'Your fleet is reviewing this report and will send it to the insurer. You can add photos until then.' : status === 'closed' ? 'This claim is closed.' : 'This claim has been sent to the insurer. Your fleet will deal with any questions.'}</Notice>
      )}
      {inbox && (
        <>
          <section className="panel next-step"><div className="panel-body">
            <h2>Assignment</h2>
            <p className="subtext">Handler · {handlerLabel(inbox, ctx.user.id)}. Take, pass, or return to the pile. The fleet never sees this.</p>
            <AssignForm claim={c.id} me={ctx.user.id} handlerId={c.handler_id ?? null} handlers={handlers} />
          </div></section>
          <ClockList claim={inbox} now={new Date()} />
        </>
      )}
      {side === 'insurer' && (
        <section className="panel next-step"><div className="panel-body">
          <h2>{status === 'closed' ? 'Closed claim' : 'Update this claim'}</h2>
          <InsurerPanel claim={c.id} status={status} reference={c.insurer_reference ?? ''} />
        </div></section>
      )}

      {cue && (
        <section className="panel"><div className="panel-body">
          <div className="cardhead"><h2>Claims and Underwriting Exchange (CUE)</h2><Badge warn>Not connected</Badge></div>
          <CuePanel claim={c.id} submissions={cue} hasReference={!!c.insurer_reference} />
        </div></section>
      )}

      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>What happened</h2></div>
        <dl className="details">
          <div><dt>When</dt><dd>{londonDate(c.incident_at).split('-').reverse().join('/')} at {time(c.incident_at)}</dd></div>
          <div><dt>Where</dt><dd>{c.location}</dd></div>
          <div><dt>Vehicle</dt><dd><span className="registration">{c.registration}</span></dd></div>
          <div><dt>Driver</dt><dd>{c.driver_name || 'Not recorded'}</dd></div>
          <div><dt>Anyone injured</dt><dd>{c.anyone_injured ? 'Yes' : 'No'}</dd></div>
          {c.anyone_injured && <div><dt>Injury details</dt><dd>{c.injury_details}</dd></div>}
          <div><dt>Police attended</dt><dd>{yn(c.police_attended)}{c.police_reference ? ` · ${c.police_reference}` : ''}</dd></div>
          <div><dt>Vehicle can be driven</dt><dd>{yn(c.vehicle_driveable)}</dd></div>
          <div><dt>Other party involved</dt><dd>{yn(c.third_party_involved)}</dd></div>
          {cover && side !== 'driver' && <div><dt>Cover added to the portal</dt><dd>{londonDateTime(cover.recordedAt)}{cover.after ? ' · after the incident' : ''}</dd></div>}
          {c.on_cover_at_incident !== null && <div><dt>Vehicle register at that time</dt><dd>{c.on_cover_at_incident ? `On cover${policy ? ' · ' + policy.reference : ''}` : 'Not on cover'}</dd></div>}
        </dl>
        <h3>Description</h3>
        <p className="preline">{c.description}</p>
        {c.on_cover_at_incident !== null && <p className="subtext">The vehicle line comes from the portal&apos;s vehicle register only. The insurer decides whether a claim is accepted. Nothing here is sent to the MID or MIB.</p>}
        {canEdit && (
          <details className="withdraw"><summary>Change these details</summary>
            <ClaimForm mode="edit" vehicles={[]} drivers={[]} fleets={[]} defaults={{
              id: c.id, registration: c.registration, date: londonDate(c.incident_at), time: time(c.incident_at), location: c.location, description: c.description,
              injured: c.anyone_injured, injury: c.injury_details ?? '', police: c.police_attended, policeRef: c.police_reference ?? '', driveable: c.vehicle_driveable, thirdParty: c.third_party_involved
            }} />
          </details>
        )}
      </div></section>

      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Photos and documents</h2><Badge>{files.length}</Badge></div>
        {files.length === 0 && <p className="subtext">Nothing added yet.</p>}
        <div className="photo-grid">
          {files.map(f => (
            <figure key={f.id} className="photo">
              <a href={`/claims/file/${f.id}`} target="_blank" rel="noopener noreferrer">
                {f.kind === 'photo' ? <img src={`/claims/file/${f.id}`} alt={f.caption || f.file_name} loading="lazy" /> : <span className="pdf">PDF</span>}
              </a>
              <figcaption>
                <span>{f.caption || f.file_name}</span>
                <span className="subtext">{sideName[f.uploaded_side]} · {londonDateTime(f.uploaded_at)} · {size(f.size_bytes)}{f.request_id ? ' · with an answer' : ''}</span>
                {status === 'reported' && f.uploaded_by === me && <RemoveFile claim={c.id} file={f.id} name={f.file_name} />}
              </figcaption>
            </figure>
          ))}
        </div>
        {canAttach && <PhotoUploader claim={c.id} />}
        {canAttach && status !== 'reported' && <p className="subtext">Files added after a claim has been sent cannot be removed.</p>}
      </div></section>

      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Other people involved</h2><Badge>{parties.length}</Badge></div>
        {parties.length === 0 && <p className="subtext">No one added.</p>}
        <ul className="doclist">
          {parties.map(p => (
            <li key={p.id}>
              <strong>{p.name}</strong><span className="subtext"> · {p.kind === 'witness' ? 'Witness' : 'Other party'}{p.phone ? ` · ${p.phone}` : ''}{p.vehicle_registration ? ` · ${p.vehicle_registration}` : ''}{p.insurer_name ? ` · insured by ${p.insurer_name}` : ''}{p.injured ? ' · injured' : ''}{p.notes ? ` · ${p.notes}` : ''}</span>
              {status === 'reported' && canParty && p.added_by === me && <RemoveParty claim={c.id} party={p.id} name={p.name} />}
            </li>
          ))}
        </ul>
        {canParty && <details className="withdraw"><summary>Add a person</summary><PartyForm claim={c.id} /></details>}
      </div></section>

      {requests.length > 0 && (
        <section className="panel"><div className="panel-body">
          <div className="cardhead"><h2>{side === 'insurer' ? 'Questions and requests you have sent' : 'Questions from the insurer'}</h2><Badge warn={openRequests.length > 0}>{openRequests.length} open</Badge></div>
          <ul className="requests">
            {requests.map(r => (
              <li key={r.id}>
                <p><strong>{r.question}</strong> <Badge warn={!r.answered_at && !r.cancelled_at}>{r.cancelled_at ? 'Withdrawn' : r.answered_at ? 'Answered' : 'Waiting for the fleet'}</Badge></p>
                <p className="subtext">Asked {londonDateTime(r.requested_at)}{r.due_on ? ` · needed by ${new Date(r.due_on + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' })}` : ''}</p>
                {itemsOf(r.id).length > 0 && (
                  <>
                    <p className="subtext">{itemProgress(itemsOf(r.id)).done} of {itemsOf(r.id).length} received</p>
                    <ul className="item-list">{itemsOf(r.id).map(i => <li key={i.id} className="item-row"><strong>{itemTitle(i)}</strong> <ItemBadge item={i} />{i.unavailable_reason && <span className="subtext"> · {i.unavailable_reason}</span>}</li>)}</ul>
                  </>
                )}
                {r.answer && <p className="answer-text">{r.answer}</p>}
                {side === 'insurer' && !r.answered_at && !r.cancelled_at && open && <WithdrawQuestion claim={c.id} request={r.id} />}
              </li>
            ))}
          </ul>
        </div></section>
      )}

      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Activity</h2></div>
        <ol className="timeline">
          {[...events].reverse().map(e => (
            <li key={e.id}>
              <div><strong>{eventTitle[e.kind] ?? e.kind}</strong> <span className="subtext">· {e.actor_label ?? sideName[e.side]}{e.actor_email ? ` (${e.actor_email})` : ''} · {londonDateTime(e.created_at)}</span>{e.visibility !== 'shared' && <> <Badge>Only {e.visibility === 'fleet' ? 'the fleet' : 'the insurer'}</Badge></>}</div>
              {e.body && <p className="preline">{e.body}</p>}
            </li>
          ))}
        </ol>
        {(side === 'fleet' || (side === 'insurer' && c.submitted_at)) && <NoteForm claim={c.id} label={side === 'insurer' ? 'Add a note for the fleet' : status === 'reported' ? 'Add a note' : 'Add a note for the insurer'} />}
      </div></section>
    </>
  );
}

function DemoClaim({ ctx, id }: { ctx: NonNullable<Awaited<ReturnType<typeof getContext>>>; id: string }) {
  const now = new Date();
  const claim = demoInboxClaims(now, ctx.user.id).find(c => c.id === id);
  if (!claim) notFound();
  const handlers = [
    { user_id: ctx.user.id, email: ctx.user.email },
    { user_id: demoPriyaId, email: demoPriyaEmail }
  ];
  return (
    <>
      <PageHeader crumb="CLAIMS" title={claim.reference} subtitle={`${claim.registration} · ${orgName(ctx, claim.fleet_id) !== '—' ? orgName(ctx, claim.fleet_id) : demoFleetLabel(claim.fleet_id) ?? '—'}`} actions={<LinkButton href="/claims">← Inbox</LinkButton>} />
      <Notice>Demonstration claim · Fictional record · Saving is disabled.</Notice>
      {claim.cover_after && <Notice alert><strong>Cover was recorded after the incident.</strong> The insurer decides whether the claim is accepted.</Notice>}
      <div className="claim-status">
        <Badge warn>{statusLabel[claim.status as ClaimStatus] ?? claim.status}</Badge>
        {claim.anyone_injured && <Badge warn>Injury reported</Badge>}
        <span>Handler · {handlerLabel(claim, ctx.user.id)}</span>
      </div>
      <section className="panel next-step"><div className="panel-body">
        <h2>Assignment</h2>
        <AssignForm claim={claim.id} me={ctx.user.id} handlerId={claim.handler_id} handlers={handlers} disabled />
      </div></section>
      <ClockList claim={claim} now={now} />
      <section className="panel"><div className="panel-body">
        <div className="cardhead"><h2>Requests sent to the fleet</h2><Badge warn>1 open</Badge></div>
        <ul className="requests"><li>
          <p><strong>Please send: photos of the damage, repair estimate</strong> <Badge warn>Waiting for the fleet</Badge></p>
          <p className="subtext">Sample · 1 of 2 received · needed by 3 days from now</p>
          <ul className="item-list">
            <li className="item-row received"><strong>Photos of the damage</strong> <span className="badge">Received</span></li>
            <li className="item-row waiting"><strong>Repair estimate</strong> <span className="badge warning">Waiting</span></li>
          </ul>
        </li></ul>
        <details className="withdraw" open><summary>Ask for specific photos or documents</summary><fieldset disabled className="demo-disabled"><RequestItemsForm claim={claim.id} /></fieldset></details>
      </div></section>
      <section className="panel"><div className="panel-body">
        <h2>Notes and activity</h2>
        <ol className="timeline">
          <li><div><strong>Note for the fleet</strong> <span className="subtext">· Sample insurer handler</span></div><p>Thanks for reporting this. Could you send a few more photos of the rear bumper, and the repair estimate when you have it?</p></li>
          <li><div><strong>Information provided</strong> <span className="subtext">· Sample fleet</span></div><p>Photos uploaded. Estimate to follow once the garage has quoted.</p></li>
          <li><div><strong>Internal note</strong> <span className="subtext">· Sample</span> <span className="badge">Only the insurer</span></div><p>Cover added after incident. Check with the fleet before deciding.</p></li>
        </ol>
        <p className="subtext">Sample notes and requests on a fictional claim. Nothing here is saved.</p>
      </div></section>
      <section className="panel"><div className="panel-body">
        <h2>What happened</h2>
        <p>{demoClaimNote(claim.id)}</p>
        <p className="subtext">This is a demonstration file so you can see the inbox, the clocks, and assignment. It is not a real FNOL.</p>
      </div></section>
    </>
  );
}
