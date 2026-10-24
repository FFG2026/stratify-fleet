'use client';
import { useAction } from './useAction';
import { addMember, changeMemberRole, setMemberActive, revokeInvitation } from '@/app/(app)/actions';
import { roleLabels, rolesForKind } from '@/lib/members';

export function RoleSelect({ membership, role, kind, email }: { membership: string; role: string; kind: string; email: string }) {
  const { pending, result, run } = useAction(changeMemberRole, false);
  return (
    <>
      <select aria-label={'Role for ' + email} defaultValue={role} disabled={pending}
        onChange={e => { const d = new FormData(); d.set('membership', membership); d.set('role', e.target.value); run(d); }}>
        {rolesForKind(kind).map(r => <option key={r} value={r}>{roleLabels[r]}</option>)}
      </select>
      <div role="status" className="subtext">{result?.message}</div>
    </>
  );
}

export function ActiveButton({ membership, active }: { membership: string; active: boolean }) {
  const { pending, result, run } = useAction(setMemberActive, false);
  return (
    <>
      <button disabled={pending} onClick={() => { const d = new FormData(); d.set('membership', membership); d.set('active', String(!active)); run(d); }}>
        {active ? 'Switch off access' : 'Restore access'}
      </button>
      <div role="status" className="subtext">{result?.ok === false ? result.message : ''}</div>
    </>
  );
}

export function RevokeButton({ invitation }: { invitation: string }) {
  const { pending, result, run } = useAction(revokeInvitation, false);
  return (
    <>
      <button disabled={pending} onClick={() => { const d = new FormData(); d.set('invitation', invitation); run(d); }}>Cancel invitation</button>
      <div role="status" className="subtext">{result?.ok === false ? result.message : ''}</div>
    </>
  );
}

export function AddMemberForm({ org, kind }: { org: string; kind: string }) {
  const { pending, result, onSubmit } = useAction(addMember);
  return (
    <>
      <form className="filters" onSubmit={onSubmit}>
        <input type="hidden" name="org" value={org} />
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
        <label>Temporary password (optional)<input name="password" type="text" minLength={12} maxLength={72} autoComplete="off" spellCheck={false} placeholder="At least 12 characters" /></label>
        <label>Role<select name="role" defaultValue="" required>{[<option key="" value="" disabled>Choose a role</option>, ...rolesForKind(kind).map(r => <option key={r} value={r}>{roleLabels[r]}</option>)]}</select></label>
        <button className="primary" disabled={pending}>Add person</button>
      </form>
      <div role="status" aria-live="polite" className="form-note">{result?.message}</div>
    </>
  );
}
