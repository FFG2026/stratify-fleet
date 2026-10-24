import Link from 'next/link';
import { ForgotForm } from '@/components/ForgotForm';

export const dynamic = 'force-dynamic';

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="login">
      <div className="brand"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></div>
      <div className="eyebrow">Password help</div>
      <h1>Reset your password.</h1>
      {sp.expired ? <div className="notice" role="alert">That link has expired or was already used. Request a new one below.</div> : <p>Enter your email address and we will send you a link to choose a new password.</p>}
      <ForgotForm />
      <p className="form-note"><Link href="/login">Back to sign in</Link></p>
    </main>
  );
}
