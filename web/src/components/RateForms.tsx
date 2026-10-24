'use client';
import { useAction } from './useAction';
import { addBillingRules, addRate } from '@/app/(app)/rates-actions';

const status = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={r?.ok === false ? 'form-error' : 'form-note'}>{r?.message}</div>;

export function RateForm({ policy, reference }: { policy: string; reference: string }) {
  const { pending, result, onSubmit } = useAction(addRate);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="policy" value={policy} />
      <label>Applies from<input name="from" type="date" required /></label>
      <label>Daily rate per vehicle (£)<input name="rate" inputMode="decimal" required autoComplete="off" placeholder="e.g. 8.2100" /></label>
      <label>Note (optional)<input name="note" maxLength={500} autoComplete="off" /></label>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : `Add rate to ${reference}`}</button></div>
      {status(result)}
    </form>
  );
}

export function BillingRulesForm({ insurer }: { insurer: string }) {
  const { pending, result, onSubmit } = useAction(addBillingRules);
  const yn = (name: string, label: string) => (
    <fieldset><legend>{label}</legend>
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
      <label>Tax rate as a fraction (0 until confirmed)<input name="tax" inputMode="decimal" required defaultValue="0" autoComplete="off" /></label>
      <label>Note (optional)<input name="note" maxLength={500} autoComplete="off" /></label>
      <p className="subtext">These are your own billing terms. The portal sets no defaults and does not know your tax treatment; the tax rate is stored but reports show tax separately. Nothing is applied before its start date and earlier rules are kept.</p>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save billing rules'}</button></div>
      {status(result)}
    </form>
  );
}
