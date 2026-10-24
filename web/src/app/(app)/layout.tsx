import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getContext, canViewDrivers, canManageUsers, isPlatform, isInsurerSide, isDriverOnly, orgName } from '@/lib/data';
import { Sidebar, type NavItem } from '@/components/Shell';
import { PolicySwitcher } from '@/components/ParamSelect';
import { Badge } from '@/components/ui';
import { claimSide, unreadCount } from '@/lib/claims-data';
import { signOut } from './actions';
import { canReadCrm } from '@/lib/crm';

export const dynamic = 'force-dynamic';

const nav: (NavItem & { admin?: boolean; platform?: boolean; insurer?: boolean; staff?: boolean })[] = [
  { href: '/overview', label: 'Platform overview', icon: '◈', platform: true },
  { href: '/insurer', label: 'Insurer dashboard', icon: '▦', insurer: true },
  { href: '/customer', label: 'Fleet dashboard', icon: '⌂' },
  { href: '/fleet', label: 'Vehicle register', icon: '▤' },
  { href: '/changes', label: 'Manage cover', icon: '⇄' },
  { href: '/reconciliation', label: 'Reconciliation', icon: '▥' },
  { href: '/drivers', label: 'Drivers & licences', icon: '⚑', staff: true },
  { href: '/users', label: 'Users', icon: '◎', admin: true }
];
const planned: NavItem[] = [
  { href: '/drivers', label: 'Drivers & licences', soon: true },
  { href: '/crm', label: 'Fleet CRM', soon: true }
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (ctx.user.mustChangePassword) redirect('/change-password');
  const driver = isDriverOnly(ctx);
  const driverNav: NavItem[] = [
    { href: '/driver', label: 'Driver dashboard', icon: '⌂' },
    { href: '/drivers', label: 'Drivers & licences', icon: '◎' },
    { href: '/claims', label: 'Claims / FNOL', icon: '⚑' }
  ];
  const claimsOn = !!claimSide(ctx);
  const unread = claimsOn ? await unreadCount() : 0;
  const staffNav: NavItem[] = claimsOn ? [{ href: '/claims', label: 'Claims / FNOL', icon: '⚑' }] : [];
  const items = (driver ? driverNav : [...nav.filter(i => (!i.staff || canViewDrivers(ctx)) && (!i.admin || canManageUsers(ctx)) && (!i.platform || isPlatform(ctx)) && (!i.insurer || isInsurerSide(ctx))), ...staffNav]).map(i => (i.href === '/claims' ? { ...i, badge: unread } : i));
  if (!driver && canReadCrm(ctx)) items.push({ href: '/crm', label: 'Fleet CRM', icon: '▣' });
  const initials = (ctx.user.email || 'S').slice(0, 2).toUpperCase();
  return (
    <div className="shell">
      <Sidebar items={items} planned={driver ? [] : planned.filter(p => p.href !== '/crm' && !(p.href === '/drivers' && canViewDrivers(ctx)))} />
      <div className="main">
        <header className="topbar">
          {driver ? <span /> : <Suspense fallback={null}>
            <PolicySwitcher policies={ctx.policies.map(p => ({ value: p.id, label: `${orgName(ctx, p.customer_id)} · ${p.reference}` }))} />
          </Suspense>}
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
