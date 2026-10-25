import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, canManageUsers, manageableOrgs, getMembers, isDriverOnly } from '@/lib/data';
import { PageHeader, Badge, Notice } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { ActiveButton, AddMemberForm, RevokeButton, RoleSelect } from '@/components/MemberControls';
import { roleLabels, rolesForKind, type MemberRole } from '@/lib/members';

export default async function Users({ searchParams }: { searchParams: Promise<{ org?: string; group?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx)) redirect('/driver');
  const header = <PageHeader title="Users" subtitle="Who can sign in, and what each person can see." />;
  if (!canManageUsers(ctx)) return (<>{header}<section className="panel"><div className="panel-body"><h2>User management</h2><p>This page is available to platform, insurer and fleet administrators.</p></div></section></>);
  const orgs = manageableOrgs(ctx);
  const { org, group } = await searchParams;
  const current = orgs.find(o => o.id === org) ?? orgs[0];
  if (!current) return (<>{header}<section className="panel"><div className="panel-body"><p>No organisations are available to manage.</p></div></section></>);
  let rows: Awaited<ReturnType<typeof getMembers>> = [], error = '';
  try { rows = await getMembers(current.id); } catch (e) { error = e instanceof Error ? e.message : 'Unable to load people.'; }
  const allGroups: { key: string; label: string; roles: MemberRole[] }[] = [
    { key: 'drivers', label: 'Drivers', roles: ['driver'] },
    { key: 'admins', label: 'Admins', roles: ['platform_super_admin', 'insurer_admin', 'fleet_admin'] },
    { key: 'managers', label: 'Fleet managers', roles: ['fleet_manager'] },
    { key: 'accounts', label: 'Fleet accounts', roles: ['fleet_accounts'] },
    { key: 'claims', label: 'Insurer claims', roles: ['insurer_claims'] },
    { key: 'insureraccounts', label: 'Insurer accounts', roles: ['insurer_accounts'] },
  ];
  const groups = allGroups.filter(g => g.roles.some(r => rolesForKind(current.kind).includes(r)));
  const active = groups.find(g => g.key === group);
  const countOf = (roles: MemberRole[]) => rows.filter(r => roles.includes(r.role as MemberRole)).length;
  const shown = active ? rows.filter(r => active.roles.includes(r.role as MemberRole)) : rows;
  const tabHref = (key?: string) => `/users?org=${current.id}${key ? `&group=${key}` : ''}`;
  return (
    <>
      {header}
      <Notice><strong>Who can see what.</strong> Platform administrators see everything. Insurer users see their own customers and those customers' vehicles. Fleet users see only their own fleet. These limits are enforced by the database. You cannot change your own access, and an organisation always keeps one active administrator.</Notice>
      {orgs.length > 1 && <div className="filters">
        <ParamSelect name="org" label="Organisation" value={current.id} resetParams={['group']} options={orgs.map(o => ({ value: o.id, label: `${o.name} (${o.kind === 'customer' ? 'fleet customer' : o.kind})` }))} />
      </div>}
      <nav className="tab-boxes" aria-label="Filter people by role">
        <Link className="tab-box" href={tabHref()} aria-current={!active}><strong>{rows.length}</strong><span>Everyone</span></Link>
        {groups.map(g => <Link key={g.key} className="tab-box" href={tabHref(g.key)} aria-current={active?.key === g.key}><strong>{countOf(g.roles)}</strong><span>{g.label}</span></Link>)}
      </nav>
      <div className="panel">
        <div className="panel-header"><h2>{active ? active.label : 'People'} in {current.name}</h2></div>
        {error && <Notice alert>{error}</Notice>}
        <div className="table-scroll"><table>
          <thead><tr><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th>ACTION</th></tr></thead>
          <tbody>
            {shown.map(r => {
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
        {!shown.length && !error && <div className="empty">{active ? `No ${active.label.toLowerCase()} yet.` : 'No one has been added yet.'}</div>}
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
