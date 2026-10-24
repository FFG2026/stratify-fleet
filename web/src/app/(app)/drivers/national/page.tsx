import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, canSearchNational } from '@/lib/data';
import { PageHeader, Notice } from '@/components/ui';
import { searchNational, cleanName, type NationalMatch } from '@/lib/national';

type SP = { q?: string; dob?: string };

export default async function NationalSearch({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canSearchNational(ctx)) redirect('/drivers');
  const sp = await searchParams;
  const q = cleanName(sp.q ?? ''), dob = /^\d{4}-\d{2}-\d{2}$/.test(sp.dob ?? '') ? sp.dob! : '';
  let rows: NationalMatch[] | null = null, error = '';
  if (q) {
    if (q.length < 3) error = 'Type at least three letters of the name.';
    else { try { rows = await searchNational(q, dob); } catch (e) { error = e instanceof Error ? e.message : 'Unable to search.'; } }
  }
  return (
    <>
      <PageHeader title="National driver search" subtitle="Look up a driver's history. Only drivers who chose to join the national database appear." />
      <div className="tabs-row">
        <Link prefetch={false} className="button-link" href="/drivers">By company</Link>
        <Link prefetch={false} className="button-link primary" href="/drivers/national">National search</Link>
      </div>
      <Notice>Everything here was entered by the drivers themselves and has not been checked by the portal or against the DVLA. Every search and every record you open is logged against your account. Use it only to assess a policy or a claim.</Notice>
      <section className="panel"><div className="panel-body">
        <form method="get" className="form-grid">
          <label>Driver's name<input name="q" defaultValue={q} required minLength={3} maxLength={60} autoComplete="off" placeholder="First or last name, at least three letters" /></label>
          <label>Date of birth (optional, narrows the search)<input name="dob" type="date" defaultValue={dob} /></label>
          <div className="actions"><button className="primary">Search</button></div>
        </form>
      </div></section>
      {error && <Notice alert>{error}</Notice>}
      {rows && (
        <section className="panel">
          <div className="table-scroll"><table>
            <thead><tr><th>Driver</th><th>Born</th><th>Current fleet</th><th></th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.user_id}>
                <td><strong>{r.full_name}</strong></td>
                <td>{r.date_of_birth ? new Date(r.date_of_birth + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' }) : r.birth_year ?? '—'}</td>
                <td>{r.fleet_name ?? <span className="muted">No current customer</span>}</td>
                <td><Link prefetch={false} className="textbtn" href={'/drivers/national/' + r.user_id}>Open history</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
          {!rows.length && <div className="empty">No one in the national database matches. The driver may not have opted in, or the name may be spelt differently.</div>}
          {rows.length === 25 && <p className="subtext">Only the first 25 are shown. Add more of the name or a date of birth.</p>}
        </section>
      )}
    </>
  );
}
