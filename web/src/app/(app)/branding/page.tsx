import { redirect } from 'next/navigation';
import { getContext, isPlatform } from '@/lib/data';
import { rest } from '@/lib/rest';
import { checkedId } from '@/lib/ids';
import { PageHeader, Notice } from '@/components/ui';
import { ParamSelect } from '@/components/ParamSelect';
import { getEnv } from '@/lib/env';
import { BrandingForm } from '@/components/BrandingForm';

export default async function Branding({ searchParams }: { searchParams: Promise<{ insurer?: string }> }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (ctx.demo || !isPlatform(ctx)) redirect('/');
  const sp = await searchParams;
  const insurers = ctx.orgs.filter(o => o.kind === 'insurer');
  const insurer = insurers.find(i => i.id === sp.insurer) ?? insurers[0];
  if (!insurer) return <><PageHeader title="Branding" subtitle="Make the workspace look like yours." /><Notice>No insurer is available to you.</Notice></>;
  const rows = await rest<{ display_name: string | null; accent: string | null; logo_path:string|null }[]>('/rest/v1/org_branding?select=display_name,accent,logo_path&insurer_id=eq.' + checkedId(insurer.id) + '&limit=1');
  return (
    <>
      <PageHeader title="Branding" subtitle="Manage each insurer’s logo, display name and accent colour." />
      {insurers.length > 1 && <div className="filters"><ParamSelect name="insurer" label="Insurer" value={insurer.id} resetParams={[]} options={insurers.map(i => ({ value: i.id, label: i.name }))} /></div>}
      <section className="panel"><div className="panel-header"><h2>{insurer.name}</h2></div><div className="panel-body">{rows[0]?.logo_path&&getEnv()&&<img src={getEnv()!.url+'/storage/v1/object/public/insurer-logos/'+rows[0].logo_path.split('/').map(encodeURIComponent).join('/')} alt={insurer.name+' logo'} style={{maxWidth:240,maxHeight:100,objectFit:'contain',marginBottom:24}}/>}<BrandingForm key={insurer.id+':'+(rows[0]?.logo_path||'')} insurer={insurer.id} name={rows[0]?.display_name ?? ''} accent={rows[0]?.accent ?? null} logoPath={rows[0]?.logo_path ?? null} /></div></section>
    </>
  );
}
