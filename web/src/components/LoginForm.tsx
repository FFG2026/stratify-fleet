'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { signIn, type LoginState } from '@/app/login/actions';

export function LoginForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, null);
  return (
    <>
      {!configured && <div className="notice">The database is not connected yet. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY before signing in.</div>}
      <form action={action}>
        <label>Email address<input type="email" name="email" autoComplete="username" required /></label>
        <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
        <button className="primary" disabled={!configured || pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        <div role="alert" className="form-note">{state?.error}</div>
        <p className="form-note"><Link href="/forgot-password">Forgot your password?</Link></p>
      </form>
    </>
  );
}
