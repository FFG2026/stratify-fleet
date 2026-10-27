'use client';
import { useState, useTransition } from 'react';
import { bulkAssign, bulkRequestItems, setDigest } from '@/app/(app)/claim-actions';
import { itemKinds, itemKindLabel } from '@/lib/claim-items';
import type { ActionResult } from './useAction';

// Works on the claims ticked in the table (checkboxes carry form="bulk"). Each claim goes through the normal single-claim function.
export function BulkBar({ handlers, me }: { handlers: { user_id: string; email: string }[]; me: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [other, setOther] = useState(false);
  const run = (action: (d: FormData) => Promise<ActionResult>, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(); const main = document.getElementById('bulk') as HTMLFormElement | null;
    main && new FormData(main).getAll('claim').forEach(v => data.append('claim', v));
    new FormData(e.currentTarget).forEach((v, k) => data.append(k, v));
    start(async () => setResult(await action(data)));
  };
  const toggleAll = (on: boolean) => document.querySelectorAll<HTMLInputElement>('input[name=claim][form=bulk]').forEach(b => { b.checked = on; });
  return (
    <section className="panel bulk-bar" aria-label="Actions for the ticked claims">
      <div className="panel-body">
        <form id="bulk" onSubmit={e => e.preventDefault()}>
          <h2>Ticked claims</h2>
          <div className="actions">
            <button type="button" onClick={() => toggleAll(true)}>Tick all shown</button>
            <button type="button" onClick={() => toggleAll(false)}>Clear</button>
          </div>
        </form>
        <form className="form-grid" onSubmit={e => run(bulkAssign, e)}>
          <label>Assign the ticked claims to
            <select name="handler" defaultValue="me">
              <option value="me">Me</option>
              {handlers.filter(h => h.user_id !== me).map(h => <option key={h.user_id} value={h.user_id}>{h.email}</option>)}
              <option value="unassign">Nobody (return to unassigned)</option>
            </select>
          </label>
          <div className="actions"><button disabled={pending}>Assign</button></div>
        </form>
        <details className="withdraw"><summary>Ask the fleets for the same things on every ticked claim</summary>
          <form className="form-grid" onSubmit={e => run(bulkRequestItems, e)}>
            <fieldset className="group"><legend>Items</legend>
              {itemKinds.map(k => <label className="check" key={k}><input type="checkbox" name="item" value={k} onChange={k === 'other' ? ev => setOther(ev.target.checked) : undefined} /><span>{itemKindLabel[k]}</span></label>)}
              {other && <label>What else?<input name="otherLabel" required minLength={2} maxLength={120} autoComplete="off" /></label>}
            </fieldset>
            <label>Message (optional)<textarea name="message" rows={2} maxLength={1000} /></label>
            <label>Needed by (optional)<input name="due" type="date" /></label>
            <div className="actions"><button disabled={pending}>Send requests</button></div>
          </form>
        </details>
        <div role="status" aria-live="polite" className={result?.ok === false ? 'form-error' : 'form-note'}>{result?.message}</div>
      </div>
    </section>
  );
}

export function DigestToggle({ on }: { on: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState(on);
  const [msg, setMsg] = useState('');
  return (
    <p className="subtext">Daily email summary: <strong>{state ? 'on' : 'off'}</strong>{' '}
      <button type="button" className="textbtn" disabled={pending} onClick={() => start(async () => {
        const f = new FormData(); f.set('enabled', state ? 'no' : 'yes');
        const r = await setDigest(f); if (r.ok) setState(!state); setMsg(r.ok ? '' : r.message);
      })}>{state ? 'Turn off' : 'Turn on'}</button>{msg && <span className="form-error"> {msg}</span>}</p>
  );
}
