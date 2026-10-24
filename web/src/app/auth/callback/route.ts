import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNext as safe } from '@/lib/redirect';

// Where the emailed link lands. Turns the one-time code in the link into a signed-in session, then moves on.
// Accepts both link styles Supabase can send (a PKCE "code", or a "token_hash" with a type).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const safeNext = safe(searchParams.get('next'));
  const failed = NextResponse.redirect(new URL('/forgot-password?expired=1', origin));
  try {
    const supabase = await createClient();
    const code = searchParams.get('code'), hash = searchParams.get('token_hash'), type = searchParams.get('type');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return failed;
    } else if (hash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: hash, type: type as EmailOtpType });
      if (error) return failed;
    } else return failed;
  } catch { return failed; }
  return NextResponse.redirect(new URL(safeNext, origin));
}
