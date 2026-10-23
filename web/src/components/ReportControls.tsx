'use client';
import { useRouter } from 'next/navigation';
import { useAction } from './useAction';
import { generateReport } from '@/app/(app)/actions';

export function GenerateForm({ month, policy, allowed }: { month: string; policy: string; allowed: boolean }) {
  const router = useRouter();
  // The report page is opened from the browser (not by a server-side redirect), which is more reliable with Next.js server actions.
  const { pending, result, onSubmit } = useAction(generateReport, false, r => { if (r.redirectTo) router.push(r.redirectTo); });
  return (
    <form className="actions" onSubmit={onSubmit}>
      <input type="hidden" name="month" value={month} /><input type="hidden" name="policy_id" value={policy} />
      <button className="primary" disabled={!allowed || !policy || pending}>{pending ? 'Generating…' : 'Generate saved report'}</button>
      {result && !result.ok && <span role="alert" className="form-note">{result.message}</span>}
    </form>
  );
}
export const PrintButton = () => <button type="button" onClick={() => window.print()}>↓ PDF / Print</button>;
