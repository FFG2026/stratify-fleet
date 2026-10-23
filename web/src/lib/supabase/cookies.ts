// The browser never talks to Supabase directly, so the session cookie can be HttpOnly: page scripts cannot read it.
export function sessionCookie<T extends Record<string, unknown>>(options: T) {
  return { ...options, httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
}
