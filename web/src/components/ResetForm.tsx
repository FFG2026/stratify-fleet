'use client';
import { PasswordInput } from './PasswordInput';
import { useActionState } from 'react';
import { resetPassword, type ResetState } from '@/app/reset-password/actions';

export function ResetForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, null);
  return (
    <form action={action}>
      <label>New password<PasswordInput name="password" autoComplete="new-password" minLength={8} maxLength={72} required /></label>
      <label>Repeat new password<PasswordInput name="again" autoComplete="new-password" minLength={8} maxLength={72} required /></label>
      <button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save new password'}</button>
      <div role="alert" className="form-note">{state?.error}</div>
    </form>
  );
}
