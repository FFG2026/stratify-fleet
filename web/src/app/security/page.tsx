import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getContext, rolesOf } from '@/lib/data';
import { adminRoles, mfaRequiredForAdmins } from '@/lib/mfa';
import { SecurityPanel } from '@/components/SecurityForms';

export const dynamic = 'force-dynamic';

export default async function Security({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (ctx.demo) redirect('/');
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const factor = (data.user?.factors ?? []).find(f => f.status === 'verified');
  const adminMustKeep = mfaRequiredForAdmins() && rolesOf(ctx).some(r => adminRoles.includes(r));
  return (
    <main className="login">
      <div className="brand"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></div>
      <div className="eyebrow">Account security</div>
      <h1>Two-step sign-in.</h1>
      {sp.required && !factor && <div className="notice" role="alert">Your role needs two-step sign-in before you can use the workspace. Set it up below.</div>}
      <SecurityPanel enabledFactor={factor?.id ?? null} canTurnOff={!adminMustKeep} />
      {(!sp.required || factor) && <p className="form-note"><Link href="/">Back to the workspace</Link></p>}
    </main>
  );
}
