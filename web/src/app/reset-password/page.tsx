import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ResetForm } from '@/components/ResetForm';

export const dynamic = 'force-dynamic';

export default async function ResetPassword() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/forgot-password?expired=1');
  return (
    <main className="login">
      <div className="brand"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></div>
      <div className="eyebrow">Password help</div>
      <h1>Choose a new password.</h1>
      <p>Use at least 8 characters. Avoid anything easy to guess.</p>
      <ResetForm />
    </main>
  );
}
