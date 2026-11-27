'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from '@/components/useAction';
import { shrink } from '@/lib/shrink';
import {
  addRepairerMember, assignRepairer, completeRepair, createRepairer, decideRepairQuote, insurerRepairNote, removeRepairFile, repairerNote,
  setRepairerActive, setRepairerMemberActive, submitRepairQuote, uploadRepairFile
} from '@/app/(app)/repair-actions';

const note = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={'form-note' + (r && !r.ok ? ' form-error' : '')}>{r?.message}</div>;

// ---- on the insurer's claim
export function AssignRepairerForm({ claim, current, repairers }: { claim: string; current: string | null; repairers: { id: string; name: string }[] }) {
  const { pending, onSubmit, run, result } = useAction(assignRepairer, false);
  const takeBack = () => { const d = new FormData(); d.set('id', claim); d.set('repairer', ''); run(d); };
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Pass to<select name="repairer" defaultValue={current ?? ''} required>
        <option value="" disabled>Choose a repair shop</option>
        {repairers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <div className="actions">
        <button disabled={pending} type="submit">{current ? 'Move to this shop' : 'Pass to repair shop'}</button>
        {current && <button type="button" disabled={pending} onClick={takeBack}>Take back</button>}
      </div>
      {note(result)}
    </form>
  );
}
export function InsurerRepairNoteForm({ claim }: { claim: string }) {
  const { pending, onSubmit, result } = useAction(insurerRepairNote);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Message to the repair shop<textarea name="body" required rows={2} maxLength={2000} /></label>
      <div className="actions"><button disabled={pending}>Send</button></div>
      {note(result)}
    </form>
  );
}
export function DecideQuoteForm({ claim }: { claim: string }) {
  const { pending, result, onSubmit, run } = useAction(decideRepairQuote, false);
  const send = (decision: string) => (e: React.MouseEvent<HTMLButtonElement>) => { const data = new FormData(e.currentTarget.form!); data.set('decision', decision); run(data); };
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Note to the repair shop (needed to send the quote back)<textarea name="note" rows={2} maxLength={2000} placeholder="e.g. Please itemise the paint and labour." /></label>
      <div className="actions">
        <button type="button" className="primary" disabled={pending} onClick={send('approve')}>Approve the repair</button>
        <button type="button" disabled={pending} onClick={send('revise')}>Send back for changes</button>
      </div>
      {note(result)}
    </form>
  );
}

// ---- the repair shop's own page
export function RepairNoteForm({ claim }: { claim: string }) {
  const { pending, onSubmit, result } = useAction(repairerNote);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Message to the insurer<textarea name="body" required rows={2} maxLength={2000} /></label>
      <div className="actions"><button disabled={pending}>Send</button></div>
      {note(result)}
    </form>
  );
}
export function RepairUploader({ claim, kind, label, multiple = false, accept }: { claim: string; kind: 'photo' | 'quote' | 'invoice'; label: string; multiple?: boolean; accept: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy(true); const problems: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setState({ ok: true, message: `Uploading ${i + 1} of ${files.length}…` });
      const data = new FormData();
      data.set('id', claim); data.set('kind', kind); data.set('file', await shrink(files[i]));
      const r = await uploadRepairFile(data);
      if (!r.ok) problems.push(r.message);
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    setState(problems.length ? { ok: false, message: problems.join(' ') } : { ok: true, message: files.length === 1 ? 'Uploaded.' : `${files.length} files uploaded.` });
    router.refresh();
  };
  return (
    <div className="upload">
      <label>{label}<input ref={input} type="file" multiple={multiple} accept={accept} disabled={busy} onChange={e => go(e.target.files)} /></label>
      {note(state)}
    </div>
  );
}
export function RemoveRepairFile({ claim, file, name }: { claim: string; file: string; name: string }) {
  const { pending, run, result } = useAction(removeRepairFile);
  return (
    <>
      <button type="button" disabled={pending} aria-label={`Remove ${name}`} onClick={() => { const f = new FormData(); f.set('id', claim); f.set('fileId', file); run(f); }}>Remove</button>
      {result?.ok === false && <span className="form-note form-error">{result.message}</span>}
    </>
  );
}
export function SubmitQuoteForm({ claim, defaultAmount, defaultNote }: { claim: string; defaultAmount?: string; defaultNote?: string }) {
  const { pending, onSubmit, result } = useAction(submitRepairQuote, false);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Quote total (£, including VAT)<input name="amount" inputMode="decimal" required placeholder="e.g. 1250.00" defaultValue={defaultAmount} /></label>
      <label>Note for the insurer (optional)<textarea name="note" rows={2} maxLength={2000} defaultValue={defaultNote} placeholder="e.g. Includes a respray of the nearside wing. Parts are on order." /></label>
      <p className="form-note">Upload the quote document and at least one photo of the damage first. The insurer then approves it or sends it back.</p>
      <div className="actions"><button className="primary" disabled={pending}>Send quote to the insurer</button></div>
      {note(result)}
    </form>
  );
}
export function CompleteRepairForm({ claim }: { claim: string }) {
  const { pending, onSubmit, result } = useAction(completeRepair, false);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Note on the finished work (optional)<textarea name="note" rows={2} maxLength={2000} /></label>
      <div className="actions"><button className="primary" disabled={pending}>Mark the repair as complete</button></div>
      {note(result)}
    </form>
  );
}

// ---- the insurer administrator's repair shops page
export function CreateRepairerForm({ insurer }: { insurer: string }) {
  const { pending, onSubmit, result } = useAction(createRepairer);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="insurer" value={insurer} />
      <label>Repair shop name<input name="name" required minLength={2} maxLength={120} /></label>
      <div className="actions"><button disabled={pending}>Add repair shop</button></div>
      {note(result)}
    </form>
  );
}
export function RepairerActiveButton({ repairer, active }: { repairer: string; active: boolean }) {
  const { pending, run, result } = useAction(setRepairerActive, false);
  const go = () => { const d = new FormData(); d.set('repairer', repairer); d.set('active', active ? 'no' : 'yes'); run(d); };
  return <><button type="button" disabled={pending} onClick={go}>{active ? 'Switch off' : 'Switch on'}</button>{result && !result.ok && note(result)}</>;
}
export function AddRepairerMemberForm({ repairer, name }: { repairer: string; name: string }) {
  const { pending, onSubmit, result } = useAction(addRepairerMember);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="repairer" value={repairer} /><input type="hidden" name="repairerName" value={name} />
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label>Temporary password (only if they have no login yet)<input name="password" type="text" maxLength={72} autoComplete="off" /></label>
      <div className="actions"><button disabled={pending}>Add person</button></div>
      {note(result)}
    </form>
  );
}
export function RepairerMemberButton({ member, active }: { member: string; active: boolean }) {
  const { pending, run, result } = useAction(setRepairerMemberActive, false);
  const go = () => { const d = new FormData(); d.set('member', member); d.set('active', active ? 'no' : 'yes'); run(d); };
  return <><button type="button" disabled={pending} onClick={go}>{active ? 'Remove access' : 'Restore access'}</button>{result && !result.ok && note(result)}</>;
}
