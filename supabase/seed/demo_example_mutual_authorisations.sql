-- Demo authorisation requests for Example Mutual Insurance (FICTIONAL): a mix awaiting a decision, under query, and declined.
-- Fictional vehicles only. Safe to run more than once (stops if the ZB26 demo requests exist).
do $$
declare ins uuid; r record; rid uuid;
begin
  select insurer_id into ins from public.policies where id = '30000000-0000-4000-8000-000000000001';
  if exists (select 1 from public.cover_referrals where insurer_id = ins and registration like 'ZB26%') then raise notice 'Demo authorisations already exist.'; return; end if;
  for r in select * from (values
    ('30000000-0000-4000-8000-000000000001'::uuid,'ZB26AAA','DAF LF 230','hgv','Replacement 7.5t box truck for the Manchester route.','awaiting_authorisation',3),
    ('30000000-0000-4000-8000-000000000001'::uuid,'ZB26AAB','Mercedes Sprinter Minibus','minibus','Staff shuttle between our two depots.','queried',28),
    ('30000000-0000-4000-8000-000000000001'::uuid,'ZB26AAC','Isuzu D-Max Utility','other','Site vehicle, may tow a small plant trailer.','awaiting_authorisation',46),
    ('30000000-0000-4000-8000-000000000002'::uuid,'ZB26AAD','Iveco Daily Tipper','other','Tipper body for a new contract starting next week.','awaiting_authorisation',9),
    ('30000000-0000-4000-8000-000000000002'::uuid,'ZB26AAE','Volkswagen Caddy Maxi','van_3_5t','Added late; a temporary hire van.','declined',120)
  ) t(pol, reg, mm, vt, note, st, age)
  loop
    insert into public.cover_referrals (fleet_id, insurer_id, policy_id, registration, make_model, vehicle_type, requested_effective_at, request_note, status, created_at, updated_at, decided_at)
    select p.fleet_id, p.insurer_id, p.id, r.reg, r.mm, r.vt, now() - (r.age || ' hours')::interval + interval '1 day', r.note, r.st,
           now() - (r.age || ' hours')::interval, now() - (r.age || ' hours')::interval, case when r.st = 'declined' then now() - interval '100 hours' end
      from public.policies p where p.id = r.pol returning id into rid;
    if r.st = 'queried' then
      insert into public.cover_referral_messages (referral_id, fleet_id, side, body, created_at)
      select rid, fleet_id, 'insurer', 'Thanks. Will this carry anyone other than your own staff, and how many seats does it have?', now() - interval '24 hours' from public.cover_referrals where id = rid;
    elsif r.st = 'declined' then
      insert into public.cover_referral_messages (referral_id, fleet_id, side, body, created_at)
      select rid, fleet_id, 'insurer', 'Sorry, we cannot offer cover for short-term hire vehicles under this policy.', now() - interval '100 hours' from public.cover_referrals where id = rid;
    end if;
  end loop;
  raise notice 'Demo authorisations created.';
end $$;
