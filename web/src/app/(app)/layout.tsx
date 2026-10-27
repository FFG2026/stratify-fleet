import { telematicsView } from '@/lib/telematics-data';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { rpc } from '@/lib/rest';
import { getEnv } from '@/lib/env';
import { ApplyBranding } from '@/components/ApplyBranding';
import { adminRoles, mfaRequiredForAdmins } from '@/lib/mfa';
import { Suspense } from 'react';
import { getContext, canViewDrivers, canManageUsers, canCreateCustomers, canViewRates, canViewAudit, rolesOf, isPlatform, isInsurerSide, isInsurerOnly, isDriverOnly, isTpaOnly, canManageTpas, orgName } from '@/lib/data';
import { Sidebar, type NavItem } from '@/components/Shell';
import { PolicySwitcher } from '@/components/ParamSelect';
import { Badge } from '@/components/ui';
import { claimSide, unreadCount } from '@/lib/claims-data';
import { signOut } from './actions';
import { canReadCrm } from '@/lib/crm';
import { NotificationToasts } from '@/components/NotificationToasts';

export const dynamic = 'force-dynamic';

const nav: (NavItem & { audit?: boolean; rates?: boolean; customers?: boolean; fleet?: boolean; admin?: boolean; platform?: boolean; insurer?: boolean; staff?: boolean; telematics?: boolean; tpa?: boolean })[] = [
  { href: '/overview', label: 'Platform overview', icon: '◈', platform: true },
  { href: '/insurer', label: 'Insurer dashboard', icon: '▦', insurer: true },
  { href: '/customer', label: 'Fleet dashboard', icon: '⌂', fleet: true },
  { href: '/fleet', label: 'Vehicle register', icon: '▤' },
  { href: '/changes', label: 'Manage cover', icon: '⇄', fleet: true },
  { href: '/reconciliation', label: 'Reconciliation', icon: '▥' },
  { href: '/drivers', label: 'Drivers & licences', icon: '⚑', staff: true },
  { href: '/telematics', label: 'Telematics', icon: '◍', telematics: true },
  { href: '/organisations', label: 'Customers', icon: '▧', customers: true },
  { href: '/rates', label: 'Rates', icon: '£', rates: true },
  { href: '/branding', label: 'Branding', icon: '◐', platform: true },
  { href: '/audit', label: 'Audit log', icon: '☰', audit: true },
  { href: '/integrations', label: 'MID / MIB status', icon: '⇄', audit: true },
  { href: '/users', label: 'Users', icon: '◎', admin: true },
  { href: '/tpas', label: 'TPAs', icon: '⇢', tpa: true },
  { href: '/install', label: 'Install on phone', icon: '▯' }
];
const planned: NavItem[] = [
  { href: '/drivers', label: 'Drivers & licences', soon: true },
  { href: '/crm', label: 'Fleet CRM', soon: true }
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (ctx.user.mustChangePassword) redirect('/change-password');
  if (mfaRequiredForAdmins() && !ctx.demo && rolesOf(ctx).some(r => adminRoles.includes(r))) {
    const { data } = await (await createClient()).auth.getUser();
    if (!(data.user?.factors ?? []).some(f => f.status === 'verified')) redirect('/security?required=1');
  }
  const brand = ctx.demo ? null : (await rpc<{ display_name: string | null; accent: string | null; logo_path?:string|null }[]>('my_branding', {}).catch(() => []))[0] ?? null;
  const driver = isDriverOnly(ctx);
  const tpaOnly = isTpaOnly(ctx);
  const driverNav: NavItem[] = [
    { href: '/driver', label: 'Driver dashboard', icon: '⌂' },
    { href: '/drivers', label: 'Drivers & licences', icon: '◎' },
    { href: '/claims', label: 'Claims / FNOL', icon: '⚑' },
    { href: '/install', label: 'Install on phone', icon: '▯' }
  ];
  const claimsOn = !!claimSide(ctx);
  const unread = claimsOn ? await unreadCount() : 0;
  const staffNav: NavItem[] = claimsOn ? [{ href: '/claims', label: 'Claims / FNOL', icon: '⚑' }] : [];
  const tpaNav: NavItem[] = [{ href: '/claims', label: 'Claims', icon: '⚑' }];
  const items = (tpaOnly ? tpaNav : driver ? driverNav : [...nav.filter(i => (!i.staff || ctx.demo || canViewDrivers(ctx)) && (!i.fleet || !isInsurerOnly(ctx)) && (!i.customers || canCreateCustomers(ctx)) && (!i.rates || canViewRates(ctx)) && (!i.audit || canViewAudit(ctx)) && (!i.admin || canManageUsers(ctx)) && (!i.tpa || canManageTpas(ctx)) && (!i.platform || isPlatform(ctx)) && (i.href !== '/branding' || !ctx.demo) && (!i.insurer || isInsurerSide(ctx)) && (!i.telematics || !!telematicsView(ctx))), ...staffNav]).map(i => (i.href === '/claims' ? { ...i, badge: unread } : i));
  if (!driver && !tpaOnly && canReadCrm(ctx)) items.push({ href: '/crm', label: 'Fleet CRM', icon: '▣' });
  const initials = (ctx.user.email || 'S').slice(0, 2).toUpperCase();
  return (
    <div className="shell">
      {claimsOn && !ctx.demo && <NotificationToasts />}
      <ApplyBranding accent={brand?.accent ?? null} />
      <Sidebar brandLogo={brand?.logo_path && getEnv() ? getEnv()!.url+'/storage/v1/object/public/insurer-logos/'+brand.logo_path.split('/').map(encodeURIComponent).join('/') : null} brandName={brand?.display_name ?? null} items={items} planned={driver || tpaOnly ? [] : planned.filter(p => p.href !== '/crm' && !(p.href === '/drivers' && (ctx.demo || canViewDrivers(ctx))))} />
      <div className="main">
        <header className="topbar">
          {driver || tpaOnly ? <span /> : <Suspense fallback={null}>
            <PolicySwitcher policies={ctx.policies.map(p => ({ value: p.id, label: `${orgName(ctx, p.customer_id)} · ${p.reference}` }))} />
          </Suspense>}
          <div className="account">
            <Badge warn>{ctx.demo ? 'DEMO · READ-ONLY' : 'DEVELOPMENT'}</Badge>
            <span className="avatar">{initials}</span>
            <span className="email">{ctx.user.email}</span>
            {!ctx.demo && <a className="textbtn" href="/security">Security</a>}
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
