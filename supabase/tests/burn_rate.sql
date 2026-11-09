-- Claim costs, burn rate and monthly price. A passing run ends with: ERROR: BURN RATE TESTS PASSED (n checks).
do $$
declare
  IA uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee';
  ins uuid := '10000000-0000-4000-8000-000000000002'; f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002';
  p2 uuid; v2 uuid := 'b72eccef-b653-4b98-b713-a880c4646d02'; cid uuid; r record; n int; checks int := 0;
begin
  select id into p2 from public.policies where fleet_id = f2;
  insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start) values (v2, f2, p2, timestamptz '2026-10-01 00:00 Europe/London');
  insert into public.claims (reference, fleet_id, insurer_id, policy_id, vehicle_id, registration, origin, reported_by, status, incident_at, location, description, anyone_injured, submitted_at)
    values ('CLM-TEST-1', f2, ins, p2, v2, 'AB12CDE', 'fleet', IA, 'under_review', now() - interval '3 days', 'Test', 'Test claim for burn rate', false, now() - interval '2 days') returning id into cid;
  insert into public.claims (reference, fleet_id, insurer_id, policy_id, vehicle_id, registration, origin, reported_by, status, incident_at, location, description, anyone_injured)
    values ('CLM-TEST-2', f2, ins, p2, v2, 'AB12CDE', 'fleet', IA, 'reported', now() - interval '1 days', 'Test', 'Unsubmitted claim', false);

  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select * into r from public.fleet_policy_prices(f1) limit 1;
  if r.daily_rate <> 10 or r.monthly_price <> 304.17 then raise exception 'T1 price % %', r.daily_rate, r.monthly_price; end if;
  begin perform * from public.fleet_policy_prices(f2); raise exception 'T2 saw other fleet prices'; exception when sqlstate '42501' then null; end;
  begin perform * from public.insurer_burn_rate(ins); raise exception 'T3 fleet ran burn rate'; exception when sqlstate '42501' then null; end;
  begin perform public.set_claim_cost(cid, 1, 1); raise exception 'T4 fleet set cost'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 4;

  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_claim_cost(cid, 100, 50, 'First estimate');
  perform public.set_claim_cost(cid, 120, 30, 'Revised');
  begin perform public.set_claim_cost(cid, -1, 0); raise exception 'T5 negative accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.set_claim_cost((select id from public.claims where reference = 'CLM-TEST-2'), 5, 5); raise exception 'T6 cost on unsubmitted claim'; exception when sqlstate '42501' then null; end;
  select * into r from public.insurer_burn_rate(ins) where policy_id = p2;
  if r.claims <> 1 or r.incurred <> 150 or r.paid <> 120 or r.reserve <> 30 then raise exception 'T7 claims %, incurred % (latest cost should count once)', r.claims, r.incurred; end if;
  if r.earned_net <= 0 or r.burn_rate_pct <> round(r.incurred / r.earned_net * 100, 1) then raise exception 'T8 burn % earned %', r.burn_rate_pct, r.earned_net; end if;
  select count(*) into n from public.claim_costs where claim_id = cid; if n <> 2 then raise exception 'T9 history kept % rows', n; end if;
  reset role; checks := checks + 5;

  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_costs; if n <> 0 then raise exception 'T10 fleet read % cost rows', n; end if;
  reset role; checks := checks + 1;
  raise exception 'BURN RATE TESTS PASSED (% checks)', checks;
end $$;
