import { notFound, redirect } from 'next/navigation';
import { getContext, rolesOf } from '@/lib/data';
import { listRepairerMembers, listRepairers } from '@/lib/repairs';
import { londonDateTime } from '@/lib/dates';
import { PageHeader, Badge, Notice } from '@/components/ui';
import { AddRepairerMemberForm, CreateRepairerForm, RepairerActiveButton, RepairerMemberButton } from '@/components/RepairForms';

export default async function Repairers() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (ctx.demo) return (<><PageHeader crumb="CLAIMS" title="Repair shops" subtitle="Pass claims to a body shop." /><Notice>Demonstration workspace. Repair shops are available in a live insurer workspace.</Notice></>);
  const active = ctx.memberships.filter(m => m.active);
  const platform = rolesOf(ctx).includes('platform_super_admin');
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer' && (platform || active.some(m => m.organisation_id === o.id && m.role === 'insurer_admin')));
  if (!insurers.length) notFound();
  const shops = await listRepairers();
  const members = Object.fromEntries(await Promise.all(shops.map(async t => [t.id, await listRepairerMembers(t.id)] as const)));
  return (
    <>
      <PageHeader crumb="CLAIMS" title="Repair shops" subtitle="Body shops you pass claims to. They add photos and a quote; you approve the repair." />
      <Notice>A repair shop only sees the claims you pass to it, and only the vehicle, where it happened and the damage. It does not see the driver, injuries, police details or your notes. The fleet and any TPA on the claim can see the photos, quote and messages.</Notice>
      {insurers.map(ins => (
        <section key={ins.id} className="panel"><div className="panel-body">
          <div className="cardhead"><h2>{ins.name}</h2></div>
          {shops.filter(t => t.insurer_id === ins.id).length === 0 && <p className="subtext">No repair shops yet.</p>}
          {shops.filter(t => t.insurer_id === ins.id).map(t => (
            <div key={t.id} className="request">
              <p><strong>{t.name}</strong> <Badge warn={!t.active}>{t.active ? 'Active' : 'Switched off'}</Badge> <RepairerActiveButton repairer={t.id} active={t.active} /></p>
              <ul className="doclist">
                {(members[t.id] ?? []).map(m => (
                  <li key={m.id}><strong>{m.email}</strong><span className="subtext"> · added {londonDateTime(m.created_at)}{m.active ? '' : ' · access removed'}</span> <RepairerMemberButton member={m.id} active={m.active} /></li>
                ))}
                {(members[t.id] ?? []).length === 0 && <li className="subtext">No people yet.</li>}
              </ul>
              {t.active && <details className="withdraw"><summary>Add a person</summary><AddRepairerMemberForm repairer={t.id} name={t.name} /></details>}
            </div>
          ))}
          <details className="withdraw"><summary>Add a repair shop</summary><CreateRepairerForm insurer={ins.id} /></details>
        </div></section>
      ))}
    </>
  );
}
