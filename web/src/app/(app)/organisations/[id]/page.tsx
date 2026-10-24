import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getContext, canCreateCustomers, isPlatform, orgName } from '@/lib/data';
import { checkedId } from '@/lib/ids';
import { PageHeader, Notice, Badge, LinkButton } from '@/components/ui';
import { ChangeInsurerForm, EndPolicyForm, NewPolicyForm, RenewPolicyForm } from '@/components/OrgForms';
import { today } from '@/lib/dates';

const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' });

export default async function Customer({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canCreateCustomers(ctx)) redirect('/');
  let id: string;
  try { id = checkedId((await params).id); } catch { notFound(); }
  const org = ctx.orgs.find(o => o.id === id && o.kind === 'customer');
  if (!org) notFound();
  const policies = ctx.policies.filter(p => p.customer_id === org.id);
  const t = today();
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer').map(i => ({ id: i.id, name: i.name }));
  return (
    <>
      <PageHeader title={org.name} subtitle={`Customer of ${orgName(ctx, org.insurer_id)}`} actions={<><LinkButton href={'/users?org=' + org.id}>People</LinkButton><LinkButton href="/organisations">← All customers</LinkButton></>} />
      {!policies.length && <Notice alert>This customer has no policy yet, so no vehicle can be put on cover. Add one below.</Notice>}
      <section className="panel">
        <div className="panel-header"><h2>Policies</h2></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Policy</th><th>Starts</th><th>Last day</th><th>Status</th><th></th></tr></thead>
          <tbody>{policies.map(p => {
            const last = p.ends_on ? new Date(Date.parse(p.ends_on + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10) : null;
            const live = p.starts_on <= t && (!p.ends_on || p.ends_on > t);
            return (
              <tr key={p.id}>
                <td><strong>{p.reference}</strong></td><td>{day(p.starts_on)}</td><td>{last ? day(last) : 'Open'}</td>
                <td>{live ? <Badge>Current</Badge> : p.starts_on > t ? <Badge warn>Starts later</Badge> : <Badge warn>Ended</Badge>}</td>
                <td><Link prefetch={false} className="textbtn" href={'/rates?policy=' + p.id}>Rates</Link></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {policies.filter(p => !p.ends_on || p.ends_on > t).map(p => (
          <div className="panel-body" key={p.id}>
            <EndPolicyForm policy={p.id} reference={p.reference} />
            <RenewPolicyForm policy={p.id} reference={p.reference} />
          </div>
        ))}
        <div className="panel-body"><h3>Add a policy</h3><NewPolicyForm fleet={org.id} /></div>
      </section>
      {isPlatform(ctx) && <section className="panel"><div className="panel-body"><ChangeInsurerForm fleet={org.id} current={org.insurer_id ?? ''} insurers={insurers} /></div></section>}
    </>
  );
}
