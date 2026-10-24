'use client';
import { useRef, useState } from 'react';
import { useAction } from '@/components/useAction';
import { saveDriverProfile, uploadDriverDocument, removeDriverDocument, setDriverConsent, addDriverRecord, removeDriverRecord, declareNone } from '@/app/(app)/driver-actions';
import type { DriverProfile } from '@/lib/data';

const status = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={'form-note' + (r && !r.ok ? ' form-error' : '')}>{r?.message}</div>;

export function ProfileForm({ profile, email }: { profile: DriverProfile | null; email: string }) {
  const { pending, result, onSubmit } = useAction(saveDriverProfile, false);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label>Full name<input name="name" required maxLength={120} defaultValue={profile?.full_name ?? ''} autoComplete="name" /></label>
      <label>Date of birth<input name="dob" type="date" defaultValue={profile?.date_of_birth ?? ''} autoComplete="bday" /></label>
      <label>Driving licence number<input name="licence" maxLength={24} defaultValue={profile?.licence_number ?? ''} autoComplete="off" spellCheck={false} placeholder="16 characters, from section 5 of the card" /></label>
      <label>Phone<input name="phone" type="tel" maxLength={30} defaultValue={profile?.phone ?? ''} autoComplete="tel" /></label>
      <label>Email<input value={email} readOnly disabled /></label>
      <div className="actions"><button className="primary" disabled={pending}>Save details</button></div>
      {status(result)}
    </form>
  );
}

// Phone photos are large. Shrink pictures in the browser so they upload quickly and stay under the 4 MB limit.
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || (file.size < 1_500_000)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export function UploadForm({ kind, label, hint, withExpiry }: { kind: string; label: string; hint: string; withExpiry: boolean }) {
  const { pending, result, run } = useAction(uploadDriverDocument);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get('file');
    if (!(file instanceof File) || !file.size) { run(data); return; }
    setBusy(true);
    data.set('file', await shrink(file));
    setBusy(false);
    run(data);
    form.current?.reset();
  };
  return (
    <form ref={form} className="upload" onSubmit={submit}>
      <input type="hidden" name="kind" value={kind} />
      <div><strong>{label}</strong><p className="subtext">{hint}</p></div>
      <label>File<input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required aria-label={`${label}: choose a file`} /></label>
      {withExpiry && <label>Expiry date (optional)<input name="expires" type="date" /></label>}
      <button disabled={pending || busy}>{pending || busy ? 'Uploading…' : 'Upload'}</button>
      {status(result)}
    </form>
  );
}

export function RemoveButton({ kind, id, label }: { kind: 'document' | 'record'; id: string; label: string }) {
  const { pending, run, result } = useAction(kind === 'document' ? removeDriverDocument : removeDriverRecord);
  return (
    <>
      <button type="button" disabled={pending} aria-label={label} onClick={() => { const f = new FormData(); f.set('id', id); run(f); }}>Remove</button>
      {result?.ok === false && <div role="status" className="form-note form-error">{result.message}</div>}
    </>
  );
}

export function ConsentBox({ kind, label, statement, given, when }: { kind: string; label: string; statement: string; given: boolean; when: string | null }) {
  const { pending, run, result } = useAction(setDriverConsent);
  return (
    <div className="consent">
      <label className="check">
        <input type="checkbox" checked={given} disabled={pending} aria-label={label}
          onChange={e => { const f = new FormData(); f.set('kind', kind); f.set('given', e.target.checked ? 'true' : 'false'); run(f); }} />
        <span><strong>{label}.</strong> {statement}</span>
      </label>
      <p className="subtext">{given && when ? `Given on ${when}. Untick to withdraw.` : 'Tick the box to give your permission.'}</p>
      {status(result)}
    </div>
  );
}

export function DeclareNone({ kind, label }: { kind: 'claims' | 'convictions'; label: string }) {
  const { pending, run, result } = useAction(declareNone);
  return (
    <>
      <button type="button" disabled={pending} onClick={() => { const f = new FormData(); f.set('kind', kind); run(f); }}>{label}</button>
      {status(result)}
    </>
  );
}

const placeholders = {
  employment: { title: 'Employer', detail: 'Job title', start: 'Started', end: 'Left (leave blank if current)' },
  claim: { title: 'What happened (for example, collision, theft)', detail: 'Notes (optional)', start: 'Date of incident', end: '' },
  conviction: { title: 'Offence code (for example, SP30)', detail: 'Penalty (optional)', start: 'Date of offence', end: '' }
} as const;

export function RecordForm({ kind }: { kind: 'employment' | 'claim' | 'conviction' }) {
  const { pending, result, onSubmit } = useAction(addDriverRecord);
  const t = placeholders[kind];
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="kind" value={kind} />
      <label>{t.title}<input name="title" required maxLength={160} autoComplete="off" /></label>
      <label>{t.detail}<input name="detail" maxLength={500} autoComplete="off" /></label>
      <label>{t.start}<input name="start" type="date" required /></label>
      {kind === 'employment' && <label>{t.end}<input name="end" type="date" /></label>}
      {kind === 'claim' && <>
        <label>Were you at fault?<select name="fault" defaultValue=""><option value="">Not decided</option><option value="no">No</option><option value="yes">Yes</option></select></label>
        <label>Cost of claim, £ (optional)<input name="amount" type="number" min="0" step="0.01" inputMode="decimal" /></label>
      </>}
      {kind === 'conviction' && <label>Penalty points<input name="points" type="number" min="0" max="12" step="1" inputMode="numeric" /></label>}
      <div className="actions"><button className="primary" disabled={pending}>Add</button></div>
      {status(result)}
    </form>
  );
}
