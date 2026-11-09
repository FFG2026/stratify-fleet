'use client';
import { useAction } from './useAction';
import { setClaimCost } from '@/app/(app)/claim-actions';

export function ClaimCostForm({ id, paid, reserve }: { id: string; paid: number; reserve: number }) {
  const { pending, result, onSubmit } = useAction(setClaimCost, false);
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="id" value={id} />
      <div className="form-grid">
        <label>Paid so far (£)<input name="paid" inputMode="decimal" defaultValue={paid ? String(paid) : ''} placeholder="0" autoComplete="off" /></label>
        <label>Reserve still to pay (£)<input name="reserve" inputMode="decimal" defaultValue={reserve ? String(reserve) : ''} placeholder="0" autoComplete="off" /></label>
        <label>Note (optional)<input name="note" maxLength={500} autoComplete="off" /></label>
      </div>
      <p className="subtext">Incurred cost is paid plus reserve. Each save is kept as history, and the latest figures feed the burn rate. The customer never sees these.</p>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save claim cost'}</button></div>
      <div role="status" aria-live="polite" className={result?.ok === false ? 'form-error' : 'form-note'}>{result?.message}</div>
    </form>
  );
}
