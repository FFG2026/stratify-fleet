import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getContext, canManageUsers, orgName } from '@/lib/data';
import { Sidebar, type NavItem } from '@/components/Shell';
import { PolicySwitcher } from '@/components/ParamSelect';
import { Badge } from '@/components/ui';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';

const nav: (NavItem & { admin?: boolean })[] = [
  { href: '/overview', label: 'Platform overview', icon: '◈' },
  { href: '/insurer', label: 'Insurer dashboard', icon: '▦' },
  { href: '/customer', label: 'Fleet dashboard', icon: '⌂' },
  { href: '/fleet', label: 'Vehicle register', icon: '▤' },
  { href: '/changes', label: 'Manage cover', icon: '⇄' },
  { href: '/reconciliation', label: 'Reconciliation', icon: '▥' },
  { href: '/users', label: 'Users', icon: '◎', admin: true }
];
const planned: NavItem[] = [
  { href: '/drivers', label: 'Drivers & licences', soon: true },
  { href: '/claims', label: 'Claims / FNOL', soon: true },
  { href: '/crm', label: 'Fleet CRM', soon: true }
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const items = nav.filter(i => !i.admin || canManageUsers(ctx));
  const initials = (ctx.user.email || 'S').slice(0, 2).toUpperCase();
  return (
    <div className="shell">
      <Sidebar items={items} planned={planned} />
      <div className="main">
        <header className="topbar">
          <Suspense fallback={null}>
            <PolicySwitcher policies={ctx.policies.map(p => ({ value: p.id, label: `${orgName(ctx, p.customer_id)} · ${p.reference}` }))} />
          </Suspense>
          <div className="account">
            <Badge warn>{ctx.demo ? 'DEMO · READ-ONLY' : 'DEVELOPMENT'}</Badge>
            <span className="avatar">{initials}</span>
            <span className="email">{ctx.user.email}</span>
            <form action={signOut}><button>{ctx.demo ? 'Exit demo' : 'Sign out'}</button></form>
          </div>
        </header>
        <main>
          {ctx.demo && <div className="notice">Demonstration workspace · Fictional records · Saving is disabled.</div>}
          {children}
          <p className="workspace-note">◇ {ctx.demo ? 'Demo workspace · Synthetic data' : 'Development workspace · Authorised records only'} · No live MIB / MID connection</p>
        </main>
      </div>
    </div>
  );
}
