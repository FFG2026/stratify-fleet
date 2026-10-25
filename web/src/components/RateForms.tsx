'use client';
import { useState } from 'react';
import { useAction } from './useAction';
import { addBillingRules, addRate } from '@/app/(app)/rates-actions';

const status = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={r?.ok === false ? 'form-error' : 'form-note'}>{r?.message}</div>;

export type RatePreset = { label: string; rate: number };

export function RateForm({ policy, reference, presets = [] }: { policy: string; reference: string; presets?: RatePreset[] }) {
  const { pending, result, onSubmit } = useAction(addRate);
  const [rate, setRate] = useState('');
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="policy" value={policy} />
      {presets.length > 0 && (
        <label className="span-all">Reuse a rate you have already set (optional)
          <select value="" onChange={e => { if (e.target.value) setRate(e.target.value); }}>
            <option value="">Choose a rate to copy into the field below</option>
            {presets.map(p => <option key={p.label} value={Number(p.rate).toFixed(4)}>{p.label}</option>)}
          </select>
        </label>
      )}
      <label>Applies from<input name="from" type="date" required /></label>
      <label>Daily rate per vehicle (£)<input name="rate" inputMode="decimal" required autoComplete="off" placeholder="e.g. 8.2100" value={rate} onChange={e => setRate(e.target.value)} /></label>
      <label>Note (optional)<input name="note" maxLength={500} autoComplete="off" /></label>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : `Add rate to ${reference}`}</button></div>
      {status(result)}
    </form>
  );
}

export function BillingRulesForm({ insurer }: { insurer: string }) {
  const { pending, result, onSubmit } = useAction(addBillingRules);
  const yn = (name: string, label: string) => (
    <fieldset className="yesno-group"><legend>{label}</legend>
      <label className="inline"><input type="radio" name={name} value="yes" required /> Charged</label>
      <label className="inline"><input type="radio" name={name} value="no" /> Not charged</label>
    </fieldset>
  );
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="insurer" value={insurer} />
      <label>Applies from<input name="from" type="date" required /></label>
      {yn('start', 'The day cover starts')}
      {yn('end', 'The day cover ends (removal day)')}
      <label>Time zone<input name="timezone" required defaultValue="Europe/London" autoComplete="off" /></label>
      <label>Round amounts to (decimal places)<input name="dp" type="number" min={0} max={4} step={1} required defaultValue={2} /></label>
      <label>Insurance Premium Tax (IPT) as a fraction. Standard rate 12% = 0.12, added on top of the daily rate<input name="tax" inputMode="decimal" required defaultValue="0.12" autoComplete="off" /></label>
      <label>Note (optional)<input name="note" maxLength={500} autoComplete="off" /></label>
      <p className="subtext">These are your own billing terms. Billing choices have no defaults. IPT is pre-filled at the standard 12% (GOV.UK, unchanged since 1 June 2017) on the basis that the insurer quotes a daily rate plus IPT; change it to 0 if your rates already include tax. Reports show net, IPT and gross separately. Nothing is applied before its start date and earlier rules are kept.</p>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save billing rules'}</button></div>
      {status(result)}
    </form>
  );
}
