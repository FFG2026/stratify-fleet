import { notFound } from 'next/navigation';
import { LinkButton, PageHeader } from '@/components/ui';
import { getContext, homeFor } from '@/lib/data';

const planned: Record<string, [string, string]> = {
  drivers: ['Drivers & licences', 'Driver records, documents and licence-check permissions.'],
  claims: ['Claims / FNOL', 'Incident reporting, photos, third-party details and shared claim progress.'],
  crm: ['Fleet CRM', 'Fleet contacts, activity history and driver communications.']
};

export default async function Planned({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const info = planned[module];
  if (!info) notFound();
  const ctx = await getContext();
  const home = ctx ? homeFor(ctx) : '/customer', homeLabel = home === '/driver' ? 'Driver dashboard' : 'Fleet dashboard';
  return (
    <>
      <PageHeader title={info[0]} subtitle={info[1]} actions={<LinkButton href={home}>← {homeLabel}</LinkButton>} />
      <section className="panel planned-panel"><div className="panel-body">
        <span className="badge warning">PLANNED MODULE</span>
        <h2>{info[0]}</h2><p>{info[1]}</p><p>This module is on the roadmap. It is not available yet.</p>
        <LinkButton href={home}>Return to {homeLabel.toLowerCase()} →</LinkButton>
      </div></section>
    </>
  );
}
