'use client';
import { useAction } from '@/components/useAction';
import { assignDriver, endAssignment } from '@/app/(app)/actions';

export function AssignDriverForm({ org, drivers, today }: { org: string; drivers: { id: string; email: string }[]; today: string }) {
  const { pending, result, onSubmit } = useAction(assignDriver);
  return (
    <>
      <form className="filters" onSubmit={onSubmit}>
        <input type="hidden" name="org" value={org} />
        <label>Driver<select name="user" defaultValue="" required>{[<option key="" value="" disabled>Choose a driver</option>, ...drivers.map(d => <option key={d.id} value={d.id}>{d.email}</option>)]}</select></label>
        <label>Vehicle registration<input name="registration" required maxLength={12} autoComplete="off" spellCheck={false} /></label>
        <label>From<input name="from" type="date" defaultValue={today} required /></label>
        <button className="primary" disabled={pending || !drivers.length}>Assign</button>
      </form>
      <div role="status" aria-live="polite" className="form-note">{result?.message}</div>
    </>
  );
}

export function EndAssignmentButton({ id, label }: { id: string; label: string }) {
  const { pending, run, result } = useAction(endAssignment);
  return (
    <>
      <button type="button" disabled={pending} aria-label={label} onClick={() => { const f = new FormData(); f.set('assignment', id); run(f); }}>End today</button>
      <div role="status" className="subtext">{result?.ok === false ? result.message : ''}</div>
    </>
  );
}
