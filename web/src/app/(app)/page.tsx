import { redirect } from 'next/navigation';
import { getContext, homeFor } from '@/lib/data';

// Everyone lands on the dashboard that matches their access.
export default async function Home() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  redirect(homeFor(ctx));
}
