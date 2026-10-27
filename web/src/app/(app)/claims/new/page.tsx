import { redirect } from 'next/navigation';
import { getContext } from '@/lib/data';
import { claimSide, reportChoices } from '@/lib/claims-data';
import { PageHeader, Notice, LinkButton } from '@/components/ui';
import { ClaimForm } from '@/components/ClaimForms';

export default async function NewClaim() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  const side = claimSide(ctx);
  const head = (title: string, subtitle: string) => <PageHeader crumb="CLAIMS" title={title} subtitle={subtitle} actions={<LinkButton href="/claims">← Claims</LinkButton>} />;
  if (!side || side === 'tpa') return (<>{head('Claims / FNOL', 'Report a claim.')}<Notice>{ctx.demo ? 'Claims are not available in the demonstration workspace.' : 'Your role cannot report claims.'}</Notice></>);
  let choices = { vehicles: [] as string[], drivers: [] as { id: string; name: string }[] };
  let error = '';
  try { choices = await reportChoices(ctx); } catch (e) { error = e instanceof Error ? e.message : 'Unable to load your vehicles.'; }
  const insurer = side === 'insurer';
  return (
    <>
      {head(insurer ? 'Log a claim' : 'Report a claim', insurer ? 'Record a claim the fleet has not reported. The fleet is told as soon as you save it.' : 'Tell us what happened. Your fleet reviews it and sends it to the insurer.')}
      {error && <Notice alert>{error}</Notice>}
      <section className="panel"><div className="panel-body">
        {!insurer && <p className="subtext">If anyone is hurt or in danger, call 999 first. This form does not alert emergency services.</p>}
        <ClaimForm mode={insurer ? 'log' : 'report'} vehicles={choices.vehicles} drivers={choices.drivers}
          fleets={insurer ? ctx.orgs.filter(o => o.kind === 'customer').map(o => ({ id: o.id, name: o.name })) : []} />
      </div></section>
    </>
  );
}
