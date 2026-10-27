'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useAction } from './useAction';
import { addVehicle, bulkVehicles, type BulkResult, removeVehicle, lookupRegistration, findOpenCover, type OpenCover } from '@/app/(app)/actions';

import { bulkTemplate } from '@/lib/bulk-vehicles';

type PolicyOption = { id: string; label: string };

export function AddVehicleForm({ policies, today, allowed }: { policies: PolicyOption[]; today: string; allowed: boolean }) {
  const { pending, result, onSubmit } = useAction(addVehicle);
  const form = useRef<HTMLFormElement>(null);
  const [lookupNote, setLookupNote] = useState('');
  const [looking, startLookup] = useTransition();
  const lookUp = () => {
    const reg = (form.current?.elements.namedItem('registration') as HTMLInputElement | null)?.value.trim() ?? '';
    if (!reg) { setLookupNote('Enter a registration first.'); return; }
    setLookupNote('Looking up…');
    startLookup(async () => {
      const r = await lookupRegistration(reg);
      if (!r.ok) { setLookupNote(r.message); return; }
      const v = r.vehicle, f = form.current!;
      (f.elements.namedItem('registration') as HTMLInputElement).value = v.registration;
      (f.elements.namedItem('make') as HTMLInputElement).value = v.make;
      const bits = [v.colour, v.fuelType && v.fuelType.toLowerCase(), v.yearOfManufacture].filter(Boolean).join(' · ');
      setLookupNote(`DVLA found: ${v.make}${bits ? ` (${bits})` : ''}. Now enter the model. This does not confirm the vehicle is insured.`);
    });
  };
  return (
    <form ref={form} onSubmit={onSubmit}>
      <label>Policy
        <select name="policy_id" required defaultValue="">
          <option value="">Select a policy</option>
          {policies.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <div className="form-grid">
        <label>Registration
          <span className="lookup-row">
            <input name="registration" required maxLength={12} placeholder="e.g. AB26 CDE" autoComplete="off" />
            <button type="button" onClick={lookUp} disabled={looking || !allowed}>Look up</button>
          </span>
        </label>
        <label>Cover starts on<input name="starts_on" type="date" min={today} defaultValue={today} required /></label>
        <label>Make<input name="make" maxLength={100} required placeholder="e.g. Ford" /></label>
        <label>Model<input name="model" maxLength={100} required placeholder="e.g. Transit Custom" /></label>
      </div>
      <div className="form-note" role="status" aria-live="polite">{lookupNote}</div>
      <div className="form-note"><strong>Cover starts from the moment you press the button.</strong> Choosing today starts cover now, not at midnight. A later date starts at the beginning of that day. Cover cannot be backdated, and the exact time each vehicle was added is recorded permanently.</div>
      <div className="form-note">This records a coverage instruction in the development workspace. Insurance and MID workflows require insurer approval before production use.</div>
      <button className="primary" disabled={!allowed || pending}>{pending ? 'Recording…' : 'Record addition'}</button>
      <div role="status" aria-live="polite" className="form-note">{result?.message}</div>
    </form>
  );
}

// Bulk add: choose a CSV, check it, then add. Nothing is recorded until "Add" is pressed.
export function BulkVehicleForm({ policies, today, allowed }: { policies: PolicyOption[]; today: string; allowed: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, start] = useTransition();
  const [fileName, setFileName] = useState('');
  const run = (mode: 'preview' | 'import') => {
    const f = form.current; if (!f) return;
    const data = new FormData(f); data.set('mode', mode);
    if (!(data.get('file') instanceof File) || (data.get('file') as File).size === 0) { setResult({ ok: false, message: 'Choose a CSV file first.' }); return; }
    start(async () => { setResult(await bulkVehicles(data)); });
  };
  const template = () => {
    const url = URL.createObjectURL(new Blob([bulkTemplate], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'vehicles-template.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const ready = result?.rows?.filter(r => !r.error && !r.added).length ?? 0;
  return (
    <form ref={form} onSubmit={e => { e.preventDefault(); run('preview'); }}>
      <p className="subtext">Add a whole fleet in one go. Use a spreadsheet saved as CSV with three columns: registration, make, model. Up to 500 vehicles at a time. <button type="button" className="textbtn" onClick={template}>Download a template</button></p>
      <label>Policy
        <select name="policy_id" required defaultValue="">
          <option value="">Select a policy</option>
          {policies.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <div className="form-grid">
        <label>Cover starts on<input name="starts_on" type="date" min={today} defaultValue={today} required /></label>
        <label>CSV file<input name="file" type="file" accept=".csv,text/csv" required onChange={e => { setFileName(e.target.files?.[0]?.name ?? ''); setResult(null); }} /></label>
      </div>
      <div className="form-note"><strong>Every vehicle starts from the moment you press Add</strong> (or the start of the chosen day). Cover cannot be backdated and each vehicle is recorded individually in the audit trail.</div>
      <div className="actions">
        <button disabled={!allowed || pending || !fileName}>{pending ? 'Working…' : 'Check the file'}</button>
        {result?.stage === 'preview' && ready > 0 && <button type="button" className="primary" disabled={!allowed || pending} onClick={() => run('import')}>Add {ready} vehicle{ready === 1 ? '' : 's'}</button>}
      </div>
      <div role="status" aria-live="polite" className={result?.ok === false ? 'form-error' : 'form-note'}>{result?.message}</div>
      {result?.rows && (
        <div className="table-wrap"><table className="bulk-table">
          <thead><tr><th>Row</th><th>Registration</th><th>Make and model</th><th>Status</th></tr></thead>
          <tbody>
            {result.rows.map(r => (
              <tr key={r.line} className={r.error ? 'bad' : r.added ? 'good' : ''}>
                <td>{r.line}</td><td><span className="registration">{r.registration || '—'}</span></td><td>{[r.make, r.model].filter(Boolean).join(' ')}</td>
                <td>{r.error ? r.error : r.added ? 'Added' : 'Ready'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </form>
  );
}

export function RemoveVehicleForm({ today, allowed, policyId = '', initialQuery = '' }: { today: string; allowed: boolean; policyId?: string; initialQuery?: string }) {
  const { pending, result, onSubmit } = useAction(removeVehicle, true, () => { setChosen(null); setQuery(''); setMatches([]); setNote(''); });
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<OpenCover[]>([]);
  const [chosen, setChosen] = useState<OpenCover | null>(null);
  const [note, setNote] = useState('');
  const latest = useRef(0);

  // Search as the person types. Only the newest search may update the screen.
  useEffect(() => {
    const text = query.trim();
    if (chosen && chosen.registration.replace(/\s/g, '').toLowerCase() === text.replace(/\s/g, '').toLowerCase()) return;
    if (!text) { setMatches([]); setNote(''); setChosen(null); return; }
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      const r = await findOpenCover(text, policyId || undefined);
      if (id !== latest.current) return;
      if (!r.ok) { setMatches([]); setNote(r.message); return; }
      setMatches(r.rows);
      if (r.rows.length === 1) { setChosen(r.rows[0]); setNote(''); }
      else { setChosen(null); setNote(r.rows.length ? (r.total > r.rows.length ? `Showing ${r.rows.length} of ${r.total}. Keep typing to narrow the list.` : '') : 'No vehicle with open cover matches that. Check the registration.'); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, policyId, chosen]);

  return (
    <form onSubmit={onSubmit}>
      <label>Registration
        <input value={query} onChange={e => { setQuery(e.target.value); setChosen(null); }} maxLength={80} placeholder="Start typing a registration" autoComplete="off" autoFocus={!initialQuery} />
      </label>
      <div className="form-note" role="status" aria-live="polite">{note}</div>
      {!chosen && matches.length > 1 && (
        <ul className="match-list" aria-label="Matching vehicles">
          {matches.map(m => (
            <li key={m.id}><button type="button" onClick={() => { setChosen(m); setQuery(m.registration); setMatches([]); }}>
              <strong className="registration">{m.registration}</strong> · {m.vehicle} · {m.policyRef} · from {m.startsOn}
            </button></li>
          ))}
        </ul>
      )}
      {chosen && (
        <div className="match-card" data-testid="chosen-vehicle">
          <input type="hidden" name="period_id" value={chosen.id} />
          <strong className="registration">{chosen.registration}</strong>
          <span>{chosen.vehicle || 'Vehicle'}</span>
          <span className="form-note">Policy {chosen.policyRef} · covered from {chosen.startsOn}</span>
        </div>
      )}
      <label>First date without cover<input type="date" name="ends_on" min={today} required /></label>
      <div className="form-note">Choosing today ends cover from the moment you press the button. Cover cannot end earlier than the time it is recorded. The removal date is excluded from insured days. Closing a period preserves its history. Re-adding a vehicle creates a new period.</div>
      <button disabled={!allowed || pending || !chosen}>{pending ? 'Recording…' : 'Record removal'}</button>
      <div role="status" aria-live="polite" className="form-note">{result?.message}</div>
    </form>
  );
}
