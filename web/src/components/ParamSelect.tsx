'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// A select that writes its choice into the URL (so pages stay server-rendered and shareable) and goes back to page one.
export function ParamSelect({ name, label, value, options, resetParams = ['offset', 'hoffset', 'report'], className }: {
  name: string; label: string; value: string; options: { value: string; label: string }[]; resetParams?: string[]; className?: string;
}) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  return (
    <label className={className}>
      {label}
      <select value={value} onChange={e => {
        const q = new URLSearchParams(params.toString());
        if (e.target.value) q.set(name, e.target.value); else q.delete(name);
        resetParams.forEach(p => q.delete(p));
        router.push(path + (q.size ? '?' + q : ''));
      }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function MonthPicker({ value }: { value: string }) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  return (
    <label>
      Report month
      <input type="month" value={value} required onChange={e => {
        if (!e.target.value) return;
        const q = new URLSearchParams(params.toString());
        q.set('month', e.target.value); q.delete('report'); q.delete('hoffset');
        router.push(path + '?' + q);
      }} />
    </label>
  );
}

// Policy workspace switcher in the top bar.
export function PolicySwitcher({ policies }: { policies: { value: string; label: string }[] }) {
  const router = useRouter(), path = usePathname(), value = useSearchParams().get('policy') ?? '';
  return (
    <label className="workspace-picker">
      <span className="sr-only">Policy workspace</span>
      <select value={value} onChange={e => {
        const target = ['/fleet', '/changes', '/reconciliation'].includes(path) ? path : '/fleet';
        router.push(target + (e.target.value ? '?policy=' + e.target.value : ''));
      }}>
        <option value="">All authorised workspaces</option>
        {policies.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
    </label>
  );
}
