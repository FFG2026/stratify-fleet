'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

export type NavItem = { href: string; label: string; icon?: string; soon?: boolean };

export function Sidebar({ items, planned }: { items: NavItem[]; planned: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const link = (i: NavItem) => (
    <Link key={i.href} href={i.href} prefetch={false} onClick={() => setOpen(false)} className={(i.soon ? 'future ' : '') + (path === i.href ? 'active' : '')} aria-current={path === i.href ? 'page' : undefined}>
      {i.icon && <span className="nav-icon">{i.icon}</span>}{i.label}{i.soon && <span className="soon">SOON</span>}
    </Link>
  );
  return (
    <aside className={'sidebar' + (open ? ' menu-open' : '')} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
      <div className="mobile-navigation-header">
        <Link prefetch={false} className="mobile-navigation-brand" href="/" aria-label="Stratify home"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></Link>
        <button type="button" id="menu-toggle" aria-controls="workspace-navigation" aria-expanded={open} aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setOpen(!open)}>
          <span className="hamburger" aria-hidden="true"><span></span><span></span><span></span></span><span>Menu</span>
        </button>
      </div>
      <div className="brand"><img className="brand-logo" src="/stratify-logo.png" alt="Stratify" width={2048} height={688} /></div>
      <nav id="workspace-navigation" aria-label="Main navigation">
        <div className="nav-label">Workspace</div>
        {items.map(link)}
        {planned.length > 0 && <div className="nav-label expand-label">Expand your workspace</div>}
        {planned.map(link)}
      </nav>
      <div className="sidebar-footer"><strong>Designed for the road ahead.</strong><br />Fleet insurance, connected.<br /><span>STRATIFY PLATFORM · DEVELOPMENT</span></div>
    </aside>
  );
}

export const Main = ({ children }: { children: ReactNode }) => <main>{children}</main>;
