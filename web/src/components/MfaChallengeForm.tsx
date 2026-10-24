'use client';
import { useActionState } from 'react';
import { verifyLogin, type MfaState } from '@/app/mfa/actions';

export function MfaChallengeForm() {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyLogin, null);
  return (
    <form action={action}>
      <label>6-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus /></label>
      <button className="primary" disabled={pending}>{pending ? 'Checking…' : 'Continue'}</button>
      <div role="alert" className="form-note">{state?.error}</div>
    </form>
  );
}
