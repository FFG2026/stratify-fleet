import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, canCreateCustomers, isPlatform, orgName } from '@/lib/data';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { NewCustomerForm, NewInsurerForm } from '@/components/OrgForms';

export default async function Organisations() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canCreateCustomers(ctx)) redirect('/');
  const platform = isPlatform(ctx);
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const customers = ctx.orgs.filter(o => o.kind === 'customer');
  return (
    <>
      <PageHeader title={platform ? 'Insurers & customers' : 'Customers'} subtitle={platform ? 'Create insurers and their customers, and manage their policies.' : 'Add your customers and manage their policies.'} />
      <Notice>A new customer starts with no policy and no people. Add its policy next, so vehicles can be put on cover. The first administrator you name is invited at the same time and then adds the customer&apos;s own managers and drivers.</Notice>
      {platform && (
        <section className="panel">
          <div className="panel-header"><h2>Insurers</h2><span className="muted">{insurers.length}</span></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Insurer</th><th>Customers</th><th></th></tr></thead>
            <tbody>{insurers.map(i => (
              <tr key={i.id}><td><strong>{i.name}</strong></td><td>{customers.filter(c => c.insurer_id === i.id).length}</td><td><Link prefetch={false} className="textbtn" href={'/users?org=' + i.id}>People</Link></td></tr>
            ))}</tbody>
          </table></div>
          <div className="panel-body"><h3>Add an insurer</h3><NewInsurerForm /></div>
        </section>
      )}
      <section className="panel">
        <div className="panel-header"><h2>Customers</h2><span className="muted">{customers.length}</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Customer</th><th>Insurer</th><th>Policies</th><th></th></tr></thead>
          <tbody>{customers.map(c => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong></td><td>{orgName(ctx, c.insurer_id)}</td>
              <td>{ctx.policies.filter(p => p.customer_id === c.id).length || <Badge warn>None</Badge>}</td>
              <td><Link prefetch={false} className="textbtn" href={'/organisations/' + c.id}>Open</Link> · <Link prefetch={false} className="textbtn" href={'/users?org=' + c.id}>People</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
        {!customers.length && <div className="empty">No customers yet.</div>}
        <div className="panel-body"><h3>Add a customer</h3><NewCustomerForm insurers={insurers.map(i => ({ id: i.id, name: i.name }))} /></div>
      </section>
    </>
  );
}
