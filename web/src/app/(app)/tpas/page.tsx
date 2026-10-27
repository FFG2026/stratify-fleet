import { notFound, redirect } from 'next/navigation';
import { getContext, rolesOf } from '@/lib/data';
import { listTpaMembers, listTpas } from '@/lib/claims-data';
import { londonDateTime } from '@/lib/dates';
import { PageHeader, Badge, Notice } from '@/components/ui';
import { AddTpaMemberForm, CreateTpaForm, TpaActiveButton, TpaMemberButton } from '@/components/TpaForms';

export default async function Tpas() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (ctx.demo) return (<><PageHeader crumb="CLAIMS" title="Third-party administrators" subtitle="Let a TPA work claims for you." /><Notice>Demonstration workspace. TPAs are available in a live insurer workspace.</Notice></>);
  const active = ctx.memberships.filter(m => m.active);
  const platform = rolesOf(ctx).includes('platform_super_admin');
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer' && (platform || active.some(m => m.organisation_id === o.id && m.role === 'insurer_admin')));
  if (!insurers.length) notFound();
  const tpas = await listTpas();
  const members = Object.fromEntries(await Promise.all(tpas.map(async t => [t.id, await listTpaMembers(t.id)] as const)));
  return (
    <>
      <PageHeader crumb="CLAIMS" title="Third-party administrators" subtitle="TPAs work claims you route to them. They recommend; you keep the final decision." />
      <Notice>A TPA only sees the claims you route to it. It deals with the fleet on your behalf (messages, requests for photos and documents, reminders), and the fleet sees that as coming from you. A TPA cannot add or remove files or close a claim; you keep the final decision.</Notice>
      {insurers.map(ins => (
        <section key={ins.id} className="panel"><div className="panel-body">
          <div className="cardhead"><h2>{ins.name}</h2></div>
          {tpas.filter(t => t.insurer_id === ins.id).length === 0 && <p className="subtext">No TPAs yet.</p>}
          {tpas.filter(t => t.insurer_id === ins.id).map(t => (
            <div key={t.id} className="request">
              <p><strong>{t.name}</strong> <Badge warn={!t.active}>{t.active ? 'Active' : 'Switched off'}</Badge> <TpaActiveButton tpa={t.id} active={t.active} /></p>
              <ul className="doclist">
                {(members[t.id] ?? []).map(m => (
                  <li key={m.id}><strong>{m.email}</strong><span className="subtext"> · added {londonDateTime(m.created_at)}{m.active ? '' : ' · access removed'}</span> <TpaMemberButton member={m.id} active={m.active} /></li>
                ))}
                {(members[t.id] ?? []).length === 0 && <li className="subtext">No people yet.</li>}
              </ul>
              {t.active && <details className="withdraw"><summary>Add a person</summary><AddTpaMemberForm tpa={t.id} name={t.name} /></details>}
            </div>
          ))}
          <details className="withdraw"><summary>Add a TPA</summary><CreateTpaForm insurer={ins.id} /></details>
        </div></section>
      ))}
    </>
  );
}
