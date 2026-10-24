import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { MfaChallengeForm } from '@/components/MfaChallengeForm';
import { signOut } from '@/app/(app)/actions';

export const dynamic = 'force-dynamic';

export default async function Mfa() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const verified = (data.user.factors ?? []).some(f => f.status === 'verified');
  let aal2 = false;
  try { aal2 = (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel === 'aal2'; } catch { /* treat as not yet verified */ }
  if (!verified || aal2) redirect('/');
  return (
    <main className="login">
      <div className="brand"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></div>
      <div className="eyebrow">Two-step sign-in</div>
      <h1>Enter your code.</h1>
      <p>Open your authenticator app and type the 6-digit code for Stratify.</p>
      <MfaChallengeForm />
      <form action={signOut}><button className="textbtn">Sign out</button></form>
    </main>
  );
}
