'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from '@/components/useAction';
import { shrink } from '@/lib/shrink';
import {
  reportClaim, updateClaim, addParty, removeParty, uploadClaimFile, removeClaimFile, reviewClaim, sendClaim, withdrawClaim, addNote, answerRequest,
  startReview, askForInformation, withdrawQuestion, closeClaim, reopenClaim, markNoticesRead
} from '@/app/(app)/claim-actions';
import { insurerOutcomes, outcomeLabel } from '@/lib/claims';

const note = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={'form-note' + (r && !r.ok ? ' form-error' : '')}>{r?.message}</div>;
const photoAccept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf';

function YesNo({ name, label, value, onChange, required = true }: { name: string; label: string; value: string; onChange?: (v: string) => void; required?: boolean }) {
  return (
    <fieldset className="yesno"><legend>{label}</legend>
      <div className="choice">
        {['yes', 'no'].map(v => (
          <label key={v} className={'choice-option' + (value === v ? ' on' : '')}>
            <input type="radio" name={name} value={v} checked={value === v} required={required} onChange={() => onChange?.(v)} />{v === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Sends the chosen files one at a time (each request stays under the size limit) and reports how it went.
async function sendFiles(claim: string, files: File[], request: string | null, progress: (text: string) => void): Promise<string[]> {
  const problems: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(`Uploading ${i + 1} of ${files.length}…`);
    const data = new FormData();
    data.set('id', claim); if (request) data.set('request', request);
    data.set('file', await shrink(files[i]));
    const result = await uploadClaimFile(data);
    if (!result.ok) problems.push(result.message);
  }
  return problems;
}

export type ClaimDefaults = {
  id: string; registration: string; date: string; time: string; location: string; description: string; injured: boolean; injury: string;
  police: boolean | null; policeRef: string; driveable: boolean | null; thirdParty: boolean | null;
};
export function ClaimForm({ mode, vehicles, drivers, fleets, defaults }: {
  mode: 'report' | 'log' | 'edit'; vehicles: string[]; drivers: { id: string; name: string }[]; fleets: { id: string; name: string }[]; defaults?: ClaimDefaults;
}) {
  const router = useRouter();
  const [injured, setInjured] = useState(defaults ? (defaults.injured ? 'yes' : 'no') : '');
  const [police, setPolice] = useState(defaults?.police === true ? 'yes' : defaults?.police === false ? 'no' : '');
  const [third, setThird] = useState(defaults?.thirdParty === true ? 'yes' : defaults?.thirdParty === false ? 'no' : '');
  const [driveable, setDriveable] = useState(defaults?.driveable === true ? 'yes' : defaults?.driveable === false ? 'no' : '');
  const [now, setNow] = useState<{ date: string; time: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  useEffect(() => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    setNow({ date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` });
  }, []);
  const edit = mode === 'edit';
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.delete('photos');
    setBusy(true); setMessage(null);
    try {
      if (edit) {
        data.set('id', defaults!.id);
        const result = await updateClaim(data);
        setMessage(result);
        if (result.ok) router.refresh();
        return;
      }
      const result = await reportClaim(data);
      if (!result.ok || !result.id) { setMessage(result); return; }
      let problems: string[] = [];
      if (files.length) problems = await sendFiles(result.id, files, null, text => setMessage({ ok: true, message: text }));
      router.push('/claims/' + result.id + (problems.length ? '?upload=failed' : ''));
    } finally { setBusy(false); }
  };
  const d = now && !defaults ? now : null;
  return (
    <form className="claim-form" onSubmit={submit}>
      {mode === 'log' && (
        <fieldset className="group"><legend>Whose claim is it?</legend>
          <label>Fleet<select name="fleet" required defaultValue=""><option value="" disabled>Choose a fleet</option>{fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>Your claim reference (optional)<input name="insurerRef" maxLength={60} autoComplete="off" /></label>
        </fieldset>
      )}
      <fieldset className="group"><legend>The vehicle and driver</legend>
        <label>Vehicle registration<input name="registration" required maxLength={12} defaultValue={defaults?.registration ?? ''} list="claim-vehicles" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="For example AB12 CDE" /></label>
        {vehicles.length > 0 && <datalist id="claim-vehicles">{vehicles.map(v => <option key={v} value={v} />)}</datalist>}
        {(mode === 'report' || mode === 'log') && drivers.length > 0 && <label>Driver<select name="driver" defaultValue=""><option value="">Not listed / not sure</option>{drivers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        {(mode === 'report' || mode === 'log') && (drivers.length > 0 || mode === 'log') && <label>Driver name, if not listed<input name="driverName" maxLength={120} autoComplete="off" /></label>}
      </fieldset>
      <fieldset className="group"><legend>What happened</legend>
        <div className="two">
          <label>Date<input name="date" type="date" required defaultValue={defaults?.date ?? d?.date ?? ''} key={'d' + (d?.date ?? defaults?.date ?? '')} max={now?.date} /></label>
          <label>Time<input name="time" type="time" required defaultValue={defaults?.time ?? d?.time ?? ''} key={'t' + (d?.time ?? defaults?.time ?? '')} /></label>
        </div>
        <label>Where did it happen?<input name="location" required minLength={2} maxLength={300} defaultValue={defaults?.location ?? ''} autoComplete="off" placeholder="Road, town, postcode or car park" /></label>
        <label>Tell us what happened<textarea name="description" required minLength={10} maxLength={4000} rows={5} defaultValue={defaults?.description ?? ''} placeholder="What happened, in your own words, and what damage there is." /></label>
      </fieldset>
      <fieldset className="group"><legend>Injuries and police</legend>
        <YesNo name="injured" label="Was anyone injured?" value={injured} onChange={setInjured} />
        {injured === 'yes' && <label>Who was injured, and how?<textarea name="injury" required maxLength={2000} rows={3} defaultValue={defaults?.injury ?? ''} /></label>}
        <YesNo name="police" label="Did the police attend?" value={police} onChange={setPolice} />
        {police === 'yes' && <label>Police reference (if you have it)<input name="policeRef" maxLength={60} defaultValue={defaults?.policeRef ?? ''} autoComplete="off" /></label>}
        {mode !== 'log' && <YesNo name="driveable" label="Can the vehicle still be driven?" value={driveable} onChange={setDriveable} required={false} />}
      </fieldset>
      <fieldset className="group"><legend>Other people involved</legend>
        {mode === 'log' ? <input type="hidden" name="thirdParty" value="no" /> : <YesNo name="thirdParty" label="Was another vehicle or person involved?" value={third} onChange={setThird} />}
        {mode === 'report' && third === 'yes' && (
          <>
            <p className="subtext">Add the other party now, or on the claim page afterwards. You can add witnesses there too.</p>
            <div className="two">
              <label>Name<input name="partyName" maxLength={120} autoComplete="off" /></label>
              <label>Phone<input name="partyPhone" type="tel" maxLength={40} autoComplete="off" /></label>
              <label>Their registration<input name="partyReg" maxLength={12} autoComplete="off" autoCapitalize="characters" /></label>
              <label>Their insurer<input name="partyInsurer" maxLength={120} autoComplete="off" /></label>
            </div>
          </>
        )}
      </fieldset>
      {!edit && mode !== 'log' && (
        <fieldset className="group"><legend>Photos</legend>
          <label>Add photos of the damage, the scene and the other vehicle<input name="photos" type="file" multiple accept={photoAccept} onChange={e => setFiles([...(e.target.files ?? [])])} /></label>
          <p className="subtext">JPG, PNG, WebP or PDF, up to 4 MB each. Photos from a phone are shrunk automatically. {files.length ? `${files.length} chosen.` : 'You can also add them afterwards.'}</p>
        </fieldset>
      )}
      <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save changes' : mode === 'log' ? 'Log the claim and tell the fleet' : 'Report the claim'}</button></div>
      {note(message)}
    </form>
  );
}

export function PhotoUploader({ claim, request, label = 'Add photos or documents' }: { claim: string; request?: string; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy(true);
    const problems = await sendFiles(claim, files, request ?? null, text => setState({ ok: true, message: text }));
    setBusy(false);
    if (input.current) input.current.value = '';
    setState(problems.length ? { ok: false, message: problems.join(' ') } : { ok: true, message: files.length === 1 ? 'Uploaded.' : `${files.length} files uploaded.` });
    router.refresh();
  };
  return (
    <div className="upload">
      <label>{label}<input ref={input} type="file" multiple accept={photoAccept} disabled={busy} onChange={e => go(e.target.files)} /></label>
      {note(state)}
    </div>
  );
}

export function RemoveFile({ claim, file, name }: { claim: string; file: string; name: string }) {
  const { pending, run, result } = useAction(removeClaimFile);
  return (
    <>
      <button type="button" disabled={pending} aria-label={`Remove ${name}`} onClick={() => { const f = new FormData(); f.set('id', claim); f.set('fileId', file); run(f); }}>Remove</button>
      {result?.ok === false && <span className="form-note form-error">{result.message}</span>}
    </>
  );
}

export function PartyForm({ claim }: { claim: string }) {
  const { pending, result, onSubmit } = useAction(addParty);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Type<select name="kind" defaultValue="third_party"><option value="third_party">Other driver or party</option><option value="witness">Witness</option></select></label>
      <label>Name<input name="name" required maxLength={120} autoComplete="off" /></label>
      <label>Phone<input name="phone" type="tel" maxLength={40} autoComplete="off" /></label>
      <label>Their registration<input name="reg" maxLength={12} autoComplete="off" autoCapitalize="characters" /></label>
      <label>Their insurer<input name="insurer" maxLength={120} autoComplete="off" /></label>
      <label>Injured?<select name="injured" defaultValue=""><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label>Notes<input name="notes" maxLength={1000} autoComplete="off" /></label>
      <div className="actions"><button disabled={pending}>Add person</button></div>
      {note(result)}
    </form>
  );
}
export function RemoveParty({ claim, party, name }: { claim: string; party: string; name: string }) {
  const { pending, run } = useAction(removeParty);
  return <button type="button" disabled={pending} aria-label={`Remove ${name}`} onClick={() => { const f = new FormData(); f.set('id', claim); f.set('partyId', party); run(f); }}>Remove</button>;
}

// ---- fleet: review, send, withdraw
export function ReviewPanel({ claim, gaps, assessed, notes, fileCount }: { claim: string; gaps: string[]; assessed: boolean; notes: string; fileCount: number }) {
  const review = useAction(reviewClaim, false);
  const send = useAction(sendClaim, false);
  const withdraw = useAction(withdrawClaim, false);
  const blockers = gaps.filter(g => !/photos/i.test(g));
  return (
    <div className="review">
      {gaps.length > 0 && <ul className="gaps">{gaps.map(g => <li key={g}>{g}</li>)}</ul>}
      <form onSubmit={review.onSubmit} className="form-grid">
        <input type="hidden" name="id" value={claim} />
        <label>Your assessment (only your fleet sees this)<textarea name="notes" rows={3} maxLength={2000} defaultValue={notes} placeholder="Anything you checked or want to remember. Optional." /></label>
        {fileCount === 0 && <label className="check"><input type="checkbox" name="noPhotos" /><span>No photos are available for this claim.</span></label>}
        <div className="actions"><button disabled={review.pending || blockers.length > 0}>{assessed ? 'Review again' : 'Mark as reviewed'}</button></div>
        {note(review.result)}
      </form>
      <form onSubmit={send.onSubmit}>
        <input type="hidden" name="id" value={claim} />
        <div className="actions"><button className="primary big" disabled={send.pending || !assessed}>{send.pending ? 'Sending…' : 'Send to insurer'}</button></div>
        {!assessed && <p className="subtext">Review the claim first. Sending locks the details; after that you can still add photos, notes and answers.</p>}
        {note(send.result)}
      </form>
      <details className="withdraw"><summary>This is not a claim, or it is a duplicate</summary>
        <form onSubmit={withdraw.onSubmit} className="form-grid">
          <input type="hidden" name="id" value={claim} />
          <label>Why is it being withdrawn?<input name="note" required minLength={3} maxLength={500} autoComplete="off" /></label>
          <div className="actions"><button disabled={withdraw.pending}>Withdraw this report</button></div>
          {note(withdraw.result)}
        </form>
      </details>
    </div>
  );
}

export function NoteForm({ claim, label }: { claim: string; label: string }) {
  const { pending, result, onSubmit } = useAction(addNote);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>{label}<textarea name="body" required rows={3} maxLength={4000} /></label>
      <label className="check"><input type="checkbox" name="internal" /><span>Keep this note to my own organisation</span></label>
      <div className="actions"><button disabled={pending}>Add note</button></div>
      {note(result)}
    </form>
  );
}

export function AnswerForm({ claim, request }: { claim: string; request: string }) {
  const { pending, result, onSubmit } = useAction(answerRequest);
  return (
    <form className="form-grid answer" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} /><input type="hidden" name="request" value={request} />
      <label>Your answer<textarea name="answer" required rows={3} maxLength={4000} /></label>
      <PhotoUploader claim={claim} request={request} label="Attach photos or documents with your answer (optional)" />
      <div className="actions"><button className="primary" disabled={pending}>Send answer to the insurer</button></div>
      {note(result)}
    </form>
  );
}

// ---- insurer
export function InsurerPanel({ claim, status, reference }: { claim: string; status: string; reference: string }) {
  const start = useAction(startReview, false);
  const ask = useAction(askForInformation);
  const close = useAction(closeClaim, false);
  const reopen = useAction(reopenClaim);
  if (status === 'closed') {
    return (
      <form className="form-grid" onSubmit={reopen.onSubmit}>
        <input type="hidden" name="id" value={claim} />
        <label>Reopen this claim. Say why.<input name="note" required minLength={3} maxLength={2000} autoComplete="off" /></label>
        <div className="actions"><button disabled={reopen.pending}>Reopen</button></div>
        {note(reopen.result)}
      </form>
    );
  }
  return (
    <div className="review">
      <form className="form-grid" onSubmit={start.onSubmit}>
        <input type="hidden" name="id" value={claim} />
        <label>Your claim reference<input name="ref" maxLength={60} defaultValue={reference} autoComplete="off" /></label>
        <div className="actions"><button disabled={start.pending}>{status === 'submitted' ? 'Start review' : 'Save reference'}</button></div>
        {note(start.result)}
      </form>
      <form className="form-grid" onSubmit={ask.onSubmit}>
        <input type="hidden" name="id" value={claim} />
        <label>Ask the fleet for more information<textarea name="question" required minLength={3} maxLength={2000} rows={3} placeholder="What do you need? The fleet sees this on the claim and is notified." /></label>
        <label>Needed by (optional)<input name="due" type="date" /></label>
        <div className="actions"><button disabled={ask.pending}>Send question</button></div>
        {note(ask.result)}
      </form>
      <details className="withdraw"><summary>Close this claim</summary>
        <form className="form-grid" onSubmit={close.onSubmit}>
          <input type="hidden" name="id" value={claim} />
          <label>Outcome<select name="outcome" required defaultValue=""><option value="" disabled>Choose</option>{insurerOutcomes.map(o => <option key={o} value={o}>{outcomeLabel[o]}</option>)}</select></label>
          <label>Note for the fleet<textarea name="note" required minLength={3} maxLength={2000} rows={3} /></label>
          <div className="actions"><button disabled={close.pending}>Close claim</button></div>
          {note(close.result)}
        </form>
      </details>
    </div>
  );
}
export function WithdrawQuestion({ claim, request }: { claim: string; request: string }) {
  const { pending, run } = useAction(withdrawQuestion);
  return <button type="button" disabled={pending} onClick={() => { const f = new FormData(); f.set('id', claim); f.set('request', request); run(f); }}>Withdraw question</button>;
}

export function MarkRead() {
  const { pending, run, result } = useAction(markNoticesRead);
  return <><button type="button" disabled={pending} onClick={() => run(new FormData())}>Mark all as read</button>{result?.ok === false && <span className="form-error">{result.message}</span>}</>;
}
