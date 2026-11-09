-- Run AFTER the two migrations (cover_referrals, bordereau_detail). Sets 10% commission on every policy, agrees criteria for the demo
-- insurer's policies, and adds three sample requests (two awaiting authorisation, one under query). Safe to run once; stops if already done.
do $$
declare
  ins uuid; pol record; v_fleet uuid; v_user uuid; rid uuid; n int;
begin
  -- 10% commission across all policies, from 1 September so September to now all use it. Existing fees and minimum days are carried over.
  for pol in
    select p.id, p.insurer_id, coalesce(t.addition_fee, 0) as af, coalesce(t.removal_fee, 0) as rf, coalesce(t.minimum_cover_days, 0) as md, t.auto_accept_types as aat
      from public.policies p
      left join lateral (select * from public.policy_terms x where x.policy_id = p.id order by x.effective_from desc limit 1) t on true
     where not exists (select 1 from public.policy_terms y where y.policy_id = p.id and y.effective_from = date '2026-09-01')
  loop
    insert into public.policy_terms (policy_id, insurer_id, effective_from, commission_pct, addition_fee, removal_fee, minimum_cover_days, note, auto_accept_types)
    values (pol.id, pol.insurer_id, date '2026-09-01', 10, pol.af, pol.rf, pol.md, 'Commission 10% on all policies', pol.aat);
  end loop;

  select id into ins from public.organisations where kind = 'insurer' and lower(name) = 'northbridge mutual (demo)';
  if ins is null then raise notice 'Demo insurer not found; commission updated, referrals skipped.'; return; end if;
  if exists (select 1 from public.cover_referrals where insurer_id = ins) then raise notice 'Demo referrals already exist.'; return; end if;

  -- criteria: vans, cars and pickups are accepted automatically; anything else is referred
  for pol in
    select p.id, p.insurer_id, t.commission_pct, t.addition_fee, t.removal_fee, t.minimum_cover_days
      from public.policies p join lateral (select * from public.policy_terms x where x.policy_id = p.id order by x.effective_from desc limit 1) t on true
     where p.insurer_id = ins
  loop
    insert into public.policy_terms (policy_id, insurer_id, effective_from, commission_pct, addition_fee, removal_fee, minimum_cover_days, note, auto_accept_types)
    values (pol.id, pol.insurer_id, date '2026-10-01', pol.commission_pct, pol.addition_fee, pol.removal_fee, pol.minimum_cover_days, 'Vans, cars and pickups accepted automatically',
            array['van_3_5t', 'car', 'pickup'])
    on conflict (policy_id, effective_from) do nothing;
  end loop;

  -- sample requests from three fleets
  insert into public.cover_referrals (fleet_id, insurer_id, policy_id, registration, make_model, vehicle_type, requested_effective_at, request_note, status, created_at, updated_at)
  select p.fleet_id, ins, p.id, v.reg, v.mm, v.vt, now() + interval '1 day', v.note, v.st, now() - (v.age || ' hours')::interval, now() - (v.age || ' hours')::interval
    from (values
      ('Pennine Haulage Ltd',      'ZR26AAA', 'DAF CF 330',        'hgv',     'Replacement tractor unit for the Leeds contract.', 'awaiting_authorisation', 20),
      ('Fenwick Food Distribution','ZR26AAB', 'Mercedes Vito Tourer','minibus','Staff shuttle between depots.',                    'queried',                 30),
      ('Westgate Plant & Hire',    'ZR26AAC', 'Isuzu D-Max Utility','other',  'Site vehicle, may carry a small trailer.',          'awaiting_authorisation',  5)
    ) as v(fleet, reg, mm, vt, note, st, age)
    join public.organisations o on o.kind = 'fleet' and o.name = v.fleet and o.insurer_id = ins
    join public.policies p on p.fleet_id = o.id and p.insurer_id = ins;
  insert into public.cover_referral_messages (referral_id, fleet_id, side, body, created_at)
  select r.id, r.fleet_id, 'insurer', 'Thanks. What will this vehicle be used for, and will it carry passengers other than your own staff?', now() - interval '25 hours'
    from public.cover_referrals r where r.registration = 'ZR26AAB' and r.insurer_id = ins;
  raise notice 'Demo referrals created.';
end $$;
