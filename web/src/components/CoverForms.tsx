'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useAction } from './useAction';
import { addVehicle, removeVehicle, lookupRegistration, findOpenCover, type OpenCover } from '@/app/(app)/actions';

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
