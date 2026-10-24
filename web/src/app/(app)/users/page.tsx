import { redirect } from 'next/navigation';
import { getContext, canManageUsers, manageableOrgs, getMembers } from '@/lib/data';
import { PageHeader, Badge, Notice } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { ActiveButton, AddMemberForm, RevokeButton, RoleSelect } from '@/components/MemberControls';
import { roleLabels, type MemberRole } from '@/lib/members';

export default async function Users({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const header = <PageHeader title="Users" subtitle="Who can sign in, and what each person can see." />;
  if (!canManageUsers(ctx)) return (<>{header}<section className="panel"><div className="panel-body"><h2>User management</h2><p>This page is available to platform, insurer and fleet administrators.</p></div></section></>);
  const orgs = manageableOrgs(ctx);
  const { org } = await searchParams;
  const current = orgs.find(o => o.id === org) ?? orgs[0];
  if (!current) return (<>{header}<section className="panel"><div className="panel-body"><p>No organisations are available to manage.</p></div></section></>);
  let rows: Awaited<ReturnType<typeof getMembers>> = [], error = '';
  try { rows = await getMembers(current.id); } catch (e) { error = e instanceof Error ? e.message : 'Unable to load people.'; }
  return (
    <>
      {header}
      <Notice><strong>Who can see what.</strong> Platform administrators see everything. Insurer users see their own customers and those customers' vehicles. Fleet users see only their own fleet. These limits are enforced by the database. You cannot change your own access, and an organisation always keeps one active administrator.</Notice>
      {orgs.length > 1 && <div className="filters">
        <ParamSelect name="org" label="Organisation" value={current.id} resetParams={[]} options={orgs.map(o => ({ value: o.id, label: `${o.name} (${o.kind === 'customer' ? 'fleet customer' : o.kind})` }))} />
      </div>}
      <div className="panel">
        <div className="panel-header"><h2>People in {current.name}</h2></div>
        {error && <Notice alert>{error}</Notice>}
        <div className="table-scroll"><table>
          <thead><tr><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th>ACTION</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const self = !r.pending && r.user_id === ctx.user.id;
              return (
                <tr key={r.id}>
                  <td><strong>{r.email}</strong>{self && <div className="subtext">This is you</div>}</td>
                  <td>{r.pending || self ? roleLabels[r.role as MemberRole] ?? r.role : <RoleSelect membership={r.id} role={r.role} kind={current.kind} email={r.email} />}</td>
                  <td>{r.pending ? <Badge warn>Invitation pending</Badge> : r.active ? <Badge>Active</Badge> : <Badge warn>Switched off</Badge>}</td>
                  <td>{r.pending ? <RevokeButton invitation={r.id} /> : self ? '—' : <ActiveButton membership={r.id} active={r.active} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!rows.length && !error && <div className="empty">No one has been added yet.</div>}
      </div>
      <div className="panel">
        <div className="panel-header"><h2>Add a person</h2></div>
        <div className="panel-body">
          <AddMemberForm org={current.id} kind={current.kind} />
          <p className="subtext">If the person already has a Stratify login they get access immediately. Otherwise the invitation is held and applies the first time they sign in with that email address. No email is sent from here yet, so create their login first and tell them it is ready.</p>
        </div>
      </div>
    </>
  );
}
