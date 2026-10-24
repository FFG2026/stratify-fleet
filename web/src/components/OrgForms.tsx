'use client';
import { useAction } from './useAction';
import { createCustomer, createInsurer, createPolicy, endPolicy, renewPolicy, changeInsurer } from '@/app/(app)/org-actions';

const status = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={r?.ok === false ? 'form-error' : 'form-note'}>{r?.message}</div>;

export function NewInsurerForm() {
  const { pending, result, onSubmit } = useAction(createInsurer);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label>Insurer name<input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
      <label>First administrator's email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label>Temporary password (optional)<input name="password" type="text" minLength={8} maxLength={72} autoComplete="off" spellCheck={false} placeholder="At least 8 characters" /></label>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Creating…' : 'Create insurer'}</button></div>
      {status(result)}
    </form>
  );
}

export function NewCustomerForm({ insurers }: { insurers: { id: string; name: string }[] }) {
  const { pending, result, onSubmit } = useAction(createCustomer, true, r => { if (r.redirectTo) window.location.assign(r.redirectTo); });
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      {insurers.length === 1
        ? <input type="hidden" name="insurer" value={insurers[0].id} />
        : <label>Insurer<select name="insurer" required defaultValue=""><option value="" disabled>Choose an insurer</option>{insurers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
      <label>Customer name<input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
      <label>First administrator's email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label>Temporary password (optional)<input name="password" type="text" minLength={8} maxLength={72} autoComplete="off" spellCheck={false} placeholder="At least 8 characters" /></label>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Creating…' : 'Create customer'}</button></div>
      {status(result)}
    </form>
  );
}

export function NewPolicyForm({ fleet }: { fleet: string }) {
  const { pending, result, onSubmit } = useAction(createPolicy);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="fleet" value={fleet} />
      <label>Policy number<input name="number" required minLength={2} maxLength={60} autoComplete="off" /></label>
      <label>Description (optional)<input name="name" maxLength={120} autoComplete="off" /></label>
      <label>Starts on<input name="from" type="date" required /></label>
      <label>Ends on (optional)<input name="to" type="date" /></label>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Add policy'}</button></div>
      {status(result)}
    </form>
  );
}

export function EndPolicyForm({ policy, reference }: { policy: string; reference: string }) {
  const { pending, result, onSubmit } = useAction(endPolicy);
  return (
    <details className="withdraw"><summary>Set the last day of {reference}</summary>
      <form className="form-grid" onSubmit={onSubmit}>
        <input type="hidden" name="policy" value={policy} />
        <label>Last day of cover<input name="to" type="date" required /></label>
        <div className="actions"><button disabled={pending}>Set last day</button></div>
        {status(result)}
      </form>
    </details>
  );
}

export function RenewPolicyForm({ policy, reference }: { policy: string; reference: string }) {
  const { pending, result, onSubmit } = useAction(renewPolicy);
  return (
    <details className="withdraw"><summary>Renew {reference}</summary>
      <form className="form-grid" onSubmit={onSubmit}>
        <input type="hidden" name="policy" value={policy} />
        <label>New policy number<input name="number" required minLength={2} maxLength={60} autoComplete="off" /></label>
        <label>New policy starts on<input name="from" type="date" required /></label>
        <label>New policy ends on (optional)<input name="to" type="date" /></label>
        <label>Daily rate for the new policy (optional)<input name="rate" inputMode="decimal" autoComplete="off" placeholder="e.g. 8.2100" /></label>
        <p className="subtext">The old policy ends the day before. Every vehicle on cover moves to the new policy with no gap, keeping its original "added to portal" time. The rate is the insurer's own figure.</p>
        <div className="actions"><button disabled={pending}>{pending ? 'Renewing…' : 'Renew policy'}</button></div>
        {status(result)}
      </form>
    </details>
  );
}

export function ChangeInsurerForm({ fleet, current, insurers }: { fleet: string; current: string; insurers: { id: string; name: string }[] }) {
  const { pending, result, onSubmit } = useAction(changeInsurer);
  return (
    <details className="withdraw"><summary>Move this customer to a different insurer</summary>
      <form className="form-grid" onSubmit={onSubmit}>
        <input type="hidden" name="fleet" value={fleet} />
        <label>New insurer<select name="insurer" required defaultValue=""><option value="" disabled>Choose an insurer</option>{insurers.filter(i => i.id !== current).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <label>Why is it moving?<input name="note" required minLength={3} maxLength={500} autoComplete="off" /></label>
        <p className="subtext">Allowed only when the customer has no current policy, no vehicle on cover and no open claim. The old insurer stops seeing this customer's history straight away.</p>
        <div className="actions"><button disabled={pending}>Move customer</button></div>
        {status(result)}
      </form>
    </details>
  );
}
