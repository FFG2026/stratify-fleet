'use client';
import { useActionState } from 'react';
import { changePassword, type PasswordState } from '@/app/change-password/actions';

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, null);
  return (
    <form action={action}>
      <label>New password<input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
      <label>Repeat new password<input type="password" name="again" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
      <button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save and continue'}</button>
      <div role="alert" className="form-note">{state?.error}</div>
    </form>
  );
}
