'use client';
import { useActionState } from 'react';
import { requestReset, type ForgotState } from '@/app/forgot-password/actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, null);
  if (state?.sent) return <div className="notice" role="status">If that address has an account, we have emailed a link to choose a new password. It can take a few minutes; check your spam folder too.</div>;
  return (
    <form action={action}>
      <label>Email address<input type="email" name="email" autoComplete="username" required /></label>
      <button className="primary" disabled={pending}>{pending ? 'Sending…' : 'Email me a reset link'}</button>
      <div role="alert" className="form-note">{state?.error}</div>
    </form>
  );
}
