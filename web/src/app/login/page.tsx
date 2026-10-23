import { LoginForm } from '@/components/LoginForm';
import { getEnv } from '@/lib/env';

// Rendered per request so the Content-Security-Policy nonce can be applied to its scripts.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="login">
      <div className="brand"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></div>
      <div className="eyebrow">Fleet insurance workspace</div>
      <h1>Welcome back.</h1>
      <p>Sign in to your authorised fleet workspace.</p>
      <LoginForm configured={!!getEnv()} />
      <p className="form-note">Access is by invitation. Your organisation membership determines which records you can view.</p>
    </main>
  );
}
