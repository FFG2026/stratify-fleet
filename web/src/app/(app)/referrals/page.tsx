import { redirect } from 'next/navigation';
import { getContext, orgName, isDriverOnly, isTpaOnly, rolesOf, isInsurerSide } from '@/lib/data';
import { rest } from '@/lib/rest';
import { londonDateTime } from '@/lib/dates';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { DecideForm, RespondForm, WithdrawForm } from '@/components/ReferralForms';
import { isOpen, statusLabel, typeLabel, monthlyFromDaily, type Referral, type ReferralMessage } from '@/lib/referrals';

const cols = 'id,fleet_id,policy_id,registration,make_model,vehicle_type,requested_effective_at,request_note,status,created_at,updated_at,period_id,agreed_daily_rate';

export default async function Referrals() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (isDriverOnly(ctx) || isTpaOnly(ctx)) redirect('/');
  const header = <PageHeader title="Authorisations" subtitle="Vehicles that need the insurer's agreement before they go on cover." />;
  if (ctx.demo) return <>{header}<Notice>Not available in the demonstration workspace.</Notice></>;
  const canDecide = rolesOf(ctx).some(r => r === 'platform_super_admin' || r === 'insurer_admin');
  const insurerSide = isInsurerSide(ctx);
  let rows: Referral[] = [], messages: ReferralMessage[] = [], error = '';
  try {
    rows = await rest<Referral[]>('/rest/v1/cover_referrals' + `?select=${cols}&order=updated_at.desc&limit=100`);
    if (rows.length) messages = await rest<ReferralMessage[]>('/rest/v1/cover_referral_messages?select=id,referral_id,side,body,created_at&referral_id=in.(' + rows.map(r => r.id).join(',') + ')&order=created_at.asc&limit=1000');
  } catch (e) { error = e instanceof Error ? e.message : 'Unable to load authorisations.'; }
  // The policy's normal daily rate, shown to the insurer next to the price box. Customers without rate access simply get no hint.
  const standard: Record<string, number> = {};
  if (insurerSide && canDecide && rows.some(r => isOpen(r.status))) {
    try {
      const cards = await rest<{ policy_id: string; daily_rate: number | string; effective_from: string }[]>('/rest/v1/rate_cards?select=policy_id,daily_rate,effective_from&order=effective_from.desc&limit=500');
      const today = new Date().toISOString().slice(0, 10);
      for (const c of cards) if (c.effective_from <= today && !(c.policy_id in standard)) standard[c.policy_id] = Number(c.daily_rate);
    } catch { /* hint only */ }
  }
  const open = rows.filter(r => isOpen(r.status)), closed = rows.filter(r => !isOpen(r.status));
  const policyRef = (id: string) => ctx.policies.find(p => p.id === id)?.reference ?? '';
  const card = (r: Referral) => (
    <section className="panel" key={r.id}>
      <div className="panel-header">
        <h2><span className="registration">{r.registration}</span> {r.make_model ?? ''}</h2>
        <Badge warn={isOpen(r.status)}>{statusLabel[r.status]}</Badge>
      </div>
      <div className="panel-body">
        <p className="subtext">{orgName(ctx, r.fleet_id)} · policy {policyRef(r.policy_id)} · {typeLabel(r.vehicle_type)} · requested {londonDateTime(r.created_at)}</p>
        {r.request_note && <p>{r.request_note}</p>}
        {r.status === 'approved' && r.agreed_daily_rate != null && (
          <p><strong>Agreed price:</strong> £{Number(r.agreed_daily_rate).toFixed(2)} per day (about £{monthlyFromDaily(Number(r.agreed_daily_rate)).toFixed(2)} a month), instead of the policy rate.</p>
        )}
        {messages.filter(m => m.referral_id === r.id).map(m => (
          <div className="event" key={m.id}><strong>{m.side === 'insurer' ? 'Insurer' : 'Customer'}</strong> · {londonDateTime(m.created_at)}<p>{m.body}</p></div>
        ))}
        {insurerSide && canDecide && isOpen(r.status) && <DecideForm id={r.id} standardRate={standard[r.policy_id] ?? null} />}
        {!insurerSide && r.status === 'queried' && <RespondForm id={r.id} />}
        {!insurerSide && isOpen(r.status) && <WithdrawForm id={r.id} />}
        {r.status === 'awaiting_authorisation' && !insurerSide && <p className="subtext">With the insurer. The vehicle is not on cover until they authorise it.</p>}
      </div>
    </section>
  );
  return (
    <>
      {header}
      {error && <Notice alert>{error}</Notice>}
      <Notice>{insurerSide ? 'A vehicle appears here when it falls outside what you have agreed for the policy. It is not on cover, and not in any statement or bordereau total, until you authorise it.' : 'A vehicle you add that is outside what the insurer has agreed for your policy waits here. It is not on cover until the insurer authorises it.'}</Notice>
      {!rows.length && !error && <div className="empty">Nothing needs authorising.</div>}
      {open.length > 0 && <><h2>Needs attention ({open.length})</h2>{open.map(card)}</>}
      {closed.length > 0 && <><h2>Recently decided</h2>{closed.map(card)}</>}
    </>
  );
}
