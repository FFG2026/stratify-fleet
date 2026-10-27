import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { sessionCookie } from '@/lib/supabase/cookies';

// Content-Security-Policy with a per-request nonce: no inline scripts or styles are allowed without it.
export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== 'production') {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');
}

const publicPaths = new Set(['/login', '/forgot-password', '/auth/callback']);
// Pages a person who has not yet passed the second step may still reach.
const beforeSecondStep = new Set(['/mfa', '/login', '/forgot-password', '/auth/callback', '/reset-password']);

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  let response = NextResponse.next({ request: { headers } });

  const env = getEnv();
  const path = request.nextUrl.pathname;
  if (env) {
    const supabase = createServerClient(env.url, env.key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: list => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers } });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, sessionCookie(options)));
        }
      }
    });
    // getUser() asks Supabase Auth to validate the token; it does not trust the cookie alone.
    const { data } = await supabase.auth.getUser();
    if (!data.user && !publicPaths.has(path)) {
      const redirect = NextResponse.redirect(new URL('/login', request.url));
      redirect.headers.set('content-security-policy', csp);
      return redirect;
    }
    if (data.user && !beforeSecondStep.has(path) && (data.user.factors ?? []).some(f => f.status === 'verified')) {
      let level: string | undefined;
      try { level = (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel ?? undefined; } catch { level = 'aal2'; }
      if (level && level !== 'aal2') {
        const redirect = NextResponse.redirect(new URL('/mfa', request.url));
        redirect.headers.set('content-security-policy', csp);
        return redirect;
      }
    }
    if (data.user && path === '/login') {
      const redirect = NextResponse.redirect(new URL('/', request.url));
      redirect.headers.set('content-security-policy', csp);
      return redirect;
    }
  }
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'same-origin');
  response.headers.set('cache-control', 'no-store');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|stratify-logo.png|sw.js|manifest.webmanifest|icon-192.png|icon-512.png|icon-maskable-512.png|apple-touch-icon.png|api/cron).*)'] };
