-- Per-policy commission, admin fees, minimum cover period (billed through day 28) and the insurer bordereau.
-- A passing run ends with: ERROR: POLICY TERMS TESTS PASSED (n checks).
do $$
declare
  IA uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee';
  ins uuid := '10000000-0000-4000-8000-000000000002'; f2 uuid := '20000000-0000-4000-8000-000000000002';
  v2 uuid := 'b72eccef-b653-4b98-b713-a880c4646d02'; v1 uuid := 'cccccccc-0000-4000-8000-000000000001';
  pol uuid; r record; n int; checks int := 0; rid uuid; net numeric; ins2 uuid := '10000000-0000-4000-8000-000000000003';
begin
  select id into pol from public.policies where fleet_id = f2;
  insert into public.vehicles (id, fleet_id, registration) values (v1, f2, 'ZZ99ZZZ');
  insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start, cover_end) values
    (v1, f2, pol, timestamptz '2026-09-10 00:00 Europe/London', timestamptz '2026-09-15 12:00 Europe/London'),
    (v2, f2, pol, timestamptz '2026-08-01 00:00 Europe/London', null);

  -- the fleet cannot set or see terms, or run the bordereau
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.set_policy_terms(pol, date '2026-01-01', 10, 1, 1, 28); raise exception 'T1 fleet set terms'; exception when sqlstate '42501' then null; end;
  begin perform * from public.insurer_bordereau(ins, date '2026-09-01'); raise exception 'T2 fleet ran bordereau'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 2;

  -- insurer admin sets terms; later change is a new row; the same date cannot be rewritten
  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_policy_terms(pol, date '2026-01-01', 12.5, 5, 3, 28, 'Aviva demo terms');
  begin perform public.set_policy_terms(pol, date '2026-01-01', 1, 1, 1, 0); raise exception 'T3 rewrote terms'; exception when sqlstate '23505' then null; end;
  begin perform public.set_policy_terms(pol, date '2026-02-01', 101, 0, 0, 0); raise exception 'T4 accepted 101%%'; exception when sqlstate '22023' then null; end;
  reset role; checks := checks + 3;

  -- September: vehicle 1 is billed 21 days in September (10th to 30th) because the 28-day minimum runs into October
  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  select * into r from public.insurer_bordereau(ins, date '2026-09-01') where policy_id = pol;
  if r.vehicles <> 2 or r.vehicle_days <> 51 or r.premium_net <> 510 then raise exception 'T5 Sept: vehicles %, days %, net %', r.vehicles, r.vehicle_days, r.premium_net; end if;
  if r.additions <> 1 or r.removals <> 1 then raise exception 'T6 Sept movements % / %', r.additions, r.removals; end if;
  if r.commission <> 63.75 or r.admin_fees <> 8 or r.remuneration <> 71.75 then raise exception 'T7 Sept remuneration % % %', r.commission, r.admin_fees, r.remuneration; end if;
  if r.minimum_period_days <> 15 or not r.terms_set then raise exception 'T8 minimum days % terms %', r.minimum_period_days, r.terms_set; end if;
  -- October: the remaining 7 minimum days are billed, with no new movement
  select * into r from public.insurer_bordereau(ins, date '2026-10-01') where policy_id = pol;
  if r.premium_net <> 380 or r.additions <> 0 or r.removals <> 0 or r.minimum_period_days <> 7 then raise exception 'T9 Oct: net %, add %, rem %, min %', r.premium_net, r.additions, r.removals, r.minimum_period_days; end if;
  checks := checks + 5;

  -- the customer statement agrees with the bordereau
  rid := public.generate_reconciliation(f2, date '2026-09-01', pol);
  select premium_net into net from public.reconciliations where id = rid;
  if net <> 510 then raise exception 'T10 statement net % not 510', net; end if;
  select count(*) into n from public.reconciliation_lines where reconciliation_id = rid and min_days_added = 15;
  if n <> 1 then raise exception 'T11 minimum-days line not recorded'; end if;
  reset role; checks := checks + 2;

  -- another insurer sees nothing of this policy
  insert into public.memberships (user_id, organisation_id, role) values ('1c6288ab-66cf-4beb-b31f-8cc6498d0da4', ins2, 'insurer_admin') on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', '1c6288ab-66cf-4beb-b31f-8cc6498d0da4', 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.insurer_bordereau(ins2, date '2026-09-01') where policy_id = pol;
  if n <> 0 then raise exception 'T12 other insurer saw policy'; end if;
  reset role; checks := checks + 1;

  -- the fleet cannot read terms directly
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.policy_terms;
  if n <> 0 then raise exception 'T13 fleet read % terms rows', n; end if;
  reset role; checks := checks + 1;

  -- movement lines: vehicle 1 shows add and removal dates and its own September charge
  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  select * into r from public.insurer_bordereau_lines(ins, date '2026-09-01') where registration = 'ZZ99ZZZ';
  if r.added_on <> date '2026-09-10' or r.removed_on <> date '2026-09-15' or r.premium_net <> 210 or r.days <> 21 then raise exception 'T14 line % % % %', r.added_on, r.removed_on, r.premium_net, r.days; end if;
  if r.commission <> 26.25 or r.net_to_insurer <> 183.75 then raise exception 'T15 commission % net %', r.commission, r.net_to_insurer; end if;
  reset role; checks := checks + 2;

  raise exception 'POLICY TERMS TESTS PASSED (% checks)', checks;
end $$;
