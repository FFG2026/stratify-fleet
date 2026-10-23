'use client';
import { useRef, useState, useTransition } from 'react';
import { useAction } from './useAction';
import { addVehicle, removeVehicle, lookupRegistration } from '@/app/(app)/actions';

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
      <div className="form-note">This records a coverage instruction in the development workspace. Insurance and MID workflows require insurer approval before production use.</div>
      <button className="primary" disabled={!allowed || pending}>{pending ? 'Recording…' : 'Record addition'}</button>
      <div role="status" aria-live="polite" className="form-note">{result?.message}</div>
    </form>
  );
}

export function RemoveVehicleForm({ periods, today, allowed }: { periods: { id: string; label: string }[]; today: string; allowed: boolean }) {
  const { pending, result, onSubmit } = useAction(removeVehicle);
  return (
    <form onSubmit={onSubmit}>
      <label>Open coverage period
        <select name="period_id" required defaultValue="">
          <option value="">Select a vehicle</option>
          {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label>First date without cover<input type="date" name="ends_on" min={today} required /></label>
      <div className="form-note">The removal date is excluded from insured days. Closing a period preserves its history. Re-adding a vehicle creates a new period.</div>
      <button disabled={!allowed || pending}>{pending ? 'Recording…' : 'Record removal'}</button>
      <div role="status" aria-live="polite" className="form-note">{result?.message}</div>
    </form>
  );
}
