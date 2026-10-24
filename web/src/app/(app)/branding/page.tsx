import { redirect } from 'next/navigation';
import { getContext, canCreateCustomers } from '@/lib/data';
import { rest } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { PageHeader, Notice } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { BrandingForm } from '@/components/BrandingForm';

export default async function Branding({ searchParams }: { searchParams: Promise<{ insurer?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!canCreateCustomers(ctx)) redirect('/');
  const sp = await searchParams;
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const insurer = insurers.find(i => i.id === sp.insurer) ?? insurers[0];
  if (!insurer) return <><PageHeader title="Branding" subtitle="Make the workspace look like yours." /><Notice>No insurer is available to you.</Notice></>;
  const rows = await rest<{ display_name: string | null; accent: string | null }[]>('/rest/v1/org_branding?select=display_name,accent&insurer_id=eq.' + checkedId(insurer.id) + '&limit=1');
  return (
    <>
      <PageHeader title="Branding" subtitle="A name and accent colour for your staff and your customers' people." />
      {insurers.length > 1 && <div className="filters"><ParamSelect name="insurer" label="Insurer" value={insurer.id} resetParams={[]} options={insurers.map(i => ({ value: i.id, label: i.name }))} /></div>}
      <section className="panel"><div className="panel-header"><h2>{insurer.name}</h2></div><div className="panel-body"><BrandingForm key={insurer.id} insurer={insurer.id} name={rows[0]?.display_name ?? ''} accent={rows[0]?.accent ?? null} /></div></section>
    </>
  );
}
