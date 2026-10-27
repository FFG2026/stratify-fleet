'use client';
import { useAction } from '@/components/useAction';
import { addTpaMember, assignTpa, createTpa, insurerTpaNote, setTpaActive, setTpaMemberActive, tpaNote, tpaRecommend } from '@/app/(app)/claim-actions';
import { tpaRecommendationLabel, tpaRecommendations } from '@/lib/tpa';

const note = (r: { ok: boolean; message: string } | null) => <div role="status" aria-live="polite" className={'form-note' + (r && !r.ok ? ' form-error' : '')}>{r?.message}</div>;

// ---- on the insurer's claim
export function AssignTpaForm({ claim, current, tpas }: { claim: string; current: string | null; tpas: { id: string; name: string }[] }) {
  const { pending, onSubmit, run, result } = useAction(assignTpa, false);
  const takeBack = () => { const d = new FormData(); d.set('id', claim); d.set('tpa', ''); run(d); };
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Route to<select name="tpa" defaultValue={current ?? ''} required>
        <option value="" disabled>Choose a TPA</option>
        {tpas.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <div className="actions">
        <button disabled={pending} type="submit">{current ? 'Move to this TPA' : 'Route to TPA'}</button>
        {current && <button type="button" disabled={pending} onClick={takeBack}>Take back from the TPA</button>}
      </div>
      {note(result)}
    </form>
  );
}
export function TpaThreadForm({ claim, as }: { claim: string; as: 'insurer' | 'tpa' }) {
  const { pending, onSubmit, result } = useAction(as === 'insurer' ? insurerTpaNote : tpaNote);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>{as === 'insurer' ? 'Message to the TPA' : 'Message to the insurer'}<textarea name="body" required rows={3} maxLength={4000} /></label>
      <div className="actions"><button disabled={pending}>Send</button></div>
      {note(result)}
    </form>
  );
}
export function TpaRecommendForm({ claim, current, currentNote }: { claim: string; current: string | null; currentNote: string | null }) {
  const { pending, onSubmit, result } = useAction(tpaRecommend, false);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={claim} />
      <label>Your recommendation<select name="recommendation" defaultValue={current ?? ''} required>
        <option value="" disabled>Choose</option>
        {tpaRecommendations.map(r => <option key={r} value={r}>{tpaRecommendationLabel[r]}</option>)}
      </select></label>
      <label>Reason for the insurer<textarea name="note" required rows={3} maxLength={2000} defaultValue={currentNote ?? ''} /></label>
      <p className="form-note">You recommend; the insurer decides and closes the claim.</p>
      <div className="actions"><button disabled={pending}>{current ? 'Update recommendation' : 'Send recommendation'}</button></div>
      {note(result)}
    </form>
  );
}

// ---- the insurer administrator's TPA page
export function CreateTpaForm({ insurer }: { insurer: string }) {
  const { pending, onSubmit, result } = useAction(createTpa);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="insurer" value={insurer} />
      <label>TPA name<input name="name" required minLength={2} maxLength={120} /></label>
      <div className="actions"><button disabled={pending}>Add TPA</button></div>
      {note(result)}
    </form>
  );
}
export function TpaActiveButton({ tpa, active }: { tpa: string; active: boolean }) {
  const { pending, run, result } = useAction(setTpaActive, false);
  const go = () => { const d = new FormData(); d.set('tpa', tpa); d.set('active', active ? 'no' : 'yes'); run(d); };
  return <><button type="button" disabled={pending} onClick={go}>{active ? 'Switch off' : 'Switch on'}</button>{result && !result.ok && note(result)}</>;
}
export function AddTpaMemberForm({ tpa, name }: { tpa: string; name: string }) {
  const { pending, onSubmit, result } = useAction(addTpaMember);
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <input type="hidden" name="tpa" value={tpa} /><input type="hidden" name="tpaName" value={name} />
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label>Temporary password (only if they have no login yet)<input name="password" type="text" maxLength={72} autoComplete="off" /></label>
      <div className="actions"><button disabled={pending}>Add person</button></div>
      {note(result)}
    </form>
  );
}
export function TpaMemberButton({ member, active }: { member: string; active: boolean }) {
  const { pending, run, result } = useAction(setTpaMemberActive, false);
  const go = () => { const d = new FormData(); d.set('member', member); d.set('active', active ? 'no' : 'yes'); run(d); };
  return <><button type="button" disabled={pending} onClick={go}>{active ? 'Remove access' : 'Restore access'}</button>{result && !result.ok && note(result)}</>;
}
