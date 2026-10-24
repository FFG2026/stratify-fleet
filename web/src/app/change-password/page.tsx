import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PasswordForm } from '@/components/PasswordForm';

export const dynamic = 'force-dynamic';

export default async function ChangePassword() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  if (data.user.app_metadata?.must_change_password !== true) redirect('/');
  return (
    <main className="login">
      <div className="brand"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></div>
      <div className="eyebrow">First sign-in</div>
      <h1>Choose your password.</h1>
      <p>Your administrator gave you a temporary password. Choose your own to continue.</p>
      <PasswordForm />
    </main>
  );
}
