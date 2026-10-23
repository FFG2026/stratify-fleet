import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Context, Period, Policy } from '@/lib/types';
import { orgName, canChange } from '@/lib/data';
import { today } from '@/lib/dates';

export const Badge = ({ children, warn = false }: { children: ReactNode; warn?: boolean }) => <span className={'badge' + (warn ? ' warning' : '')}>{children}</span>;
export const fmt = (n: number | string) => Number(n).toLocaleString('en-GB');
export const Notice = ({ children, alert = false }: { children: ReactNode; alert?: boolean }) => <div className="notice" role={alert ? 'alert' : undefined}>{children}</div>;

export function Stats({ items }: { items: [string, string | number, string][] }) {
  return (
    <div className="stats">
      {items.map(([label, value, note]) => (
        <div className="stat" key={label}>
          <div className="stat-label">{label}</div>
          <div className="stat-number">{typeof value === 'number' ? fmt(value) : value}</div>
          <div className="stat-note">{note}</div>
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, crumb = 'WORKSPACE', actions }: { title: string; subtitle: string; crumb?: string; actions?: ReactNode }) {
  return (
    <>
      <div className="breadcrumb">STRATIFY &nbsp; / &nbsp; {crumb}</div>
      <div className="heading">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="actions">{actions}</div>
      </div>
    </>
  );
}

export function LinkButton({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return <Link prefetch={false} href={href} className={'button-link' + (primary ? ' primary' : '')}>{children}</Link>;
}

export function Pagination({ total, offset, limit = 25, base, param = 'offset' }: { total: number; offset: number; limit?: number; base: URLSearchParams; param?: string }) {
  const link = (value: number) => { const q = new URLSearchParams(base); q.set(param, String(value)); return '?' + q.toString(); };
  const prev = offset > 0, next = offset + limit < total;
  return (
    <div className="pagination">
      <span>{total ? offset + 1 : 0}–{Math.min(total, offset + limit)} of {total}</span>
      <div className="actions">
        {prev ? <Link prefetch={false} className="button-link" href={link(Math.max(0, offset - limit))}>Previous</Link> : <button disabled>Previous</button>}
        {next ? <Link prefetch={false} className="button-link" href={link(offset + limit)}>Next</Link> : <button disabled>Next</button>}
      </div>
    </div>
  );
}

const isActive = (r: Period, policy?: Policy) => {
  const t = today();
  const end = policy?.ends_on && (!r.ends_on || policy.ends_on < r.ends_on) ? policy.ends_on : r.ends_on ?? policy?.ends_on ?? null;
  return r.starts_on <= t && (!end || end > t);
};
export const periodStatus = (r: Period, policy?: Policy) => (isActive(r, policy) ? 'Covered' : r.starts_on > today() ? 'Scheduled' : 'Removed / expired');

export function FleetTable({ ctx, rows }: { ctx: Context; rows: Period[] }) {
  const canRemove = canChange(ctx);
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead><tr><th>REGISTRATION</th><th>VEHICLE</th><th>POLICY</th><th>START DATE</th><th>REMOVAL DATE</th><th>STATUS</th>{canRemove && <th aria-label="Actions"></th>}</tr></thead>
          <tbody>
            {rows.map(r => {
              const policy = ctx.policies.find(p => p.id === r.policy_id);
              return (
                <tr key={r.id}>
                  <td><span className="registration">{r.registration}</span></td>
                  <td><strong>{r.make}</strong><div className="subtext">{r.model}</div></td>
                  <td>{policy?.reference}</td>
                  <td>{r.starts_on}</td>
                  <td>{r.ends_on || 'Open period'}</td>
                  <td><Badge warn={!isActive(r, policy)}>{periodStatus(r, policy)}</Badge></td>
                  {canRemove && <td>{!r.ends_on && <Link prefetch={false} className="textbtn" href={'/changes?' + new URLSearchParams({ mode: 'remove', rq: r.registration.replace(/\s/g, ''), policy: r.policy_id })} aria-label={'Remove ' + r.registration}>Remove</Link>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <div className="empty">No vehicles match this view.</div>}
    </>
  );
}

export function OrgCell({ ctx, id }: { ctx: Context; id: string | null | undefined }) { return <>{orgName(ctx, id)}</>; }
