'use client';
import { useAction } from './useAction';
import { decideReferral, respondReferral, withdrawReferral } from '@/app/(app)/referral-actions';

const status = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={r?.ok === false ? 'form-error' : 'form-note'}>{r?.message}</div>;

export function DecideForm({ id }: { id: string }) {
  const { pending, result, onSubmit, run } = useAction(decideReferral);
  const send = (decision: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.form!; const data = new FormData(form); data.set('decision', decision); run(data);
  };
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="referral" value={id} />
      <label>Message to the customer (needed to query or decline)<textarea name="message" rows={2} maxLength={2000} placeholder="e.g. What will this vehicle be used for?" /></label>
      <div className="actions">
        <button type="button" className="primary" disabled={pending} onClick={send('approve')}>Authorise</button>
        <button type="button" disabled={pending} onClick={send('query')}>Query</button>
        <button type="button" disabled={pending} onClick={send('decline')}>Decline</button>
      </div>
      {status(result)}
    </form>
  );
}

export function RespondForm({ id }: { id: string }) {
  const { pending, result, onSubmit } = useAction(respondReferral);
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="referral" value={id} />
      <label>Your answer<textarea name="message" rows={2} maxLength={2000} required /></label>
      <div className="actions"><button className="primary" disabled={pending}>{pending ? 'Sending…' : 'Send answer'}</button></div>
      {status(result)}
    </form>
  );
}

export function WithdrawForm({ id }: { id: string }) {
  const { pending, result, onSubmit } = useAction(withdrawReferral);
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="referral" value={id} />
      <button disabled={pending}>{pending ? 'Withdrawing…' : 'Withdraw request'}</button>
      {status(result)}
    </form>
  );
}
