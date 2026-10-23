export type Env = { url: string; key: string };
// Server-side settings. Returns null when the database is not configured so pages can say so plainly.
export function getEnv(): Env | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
export const demoAccountEmail = () => (process.env.DEMO_ACCOUNT_EMAIL || 'demo@stratifyfleet.co.uk').toLowerCase();
