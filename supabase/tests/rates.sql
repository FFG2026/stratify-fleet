-- Rates and billing rules permission test. Rolls back.
do $$
declare
  I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; i1 uuid := '10000000-0000-4000-8000-000000000002';
  pol uuid; n int := 0;
begin
  select id into pol from public.policies where insurer_id = i1 limit 1;
  if pol is null then raise exception 'test needs a policy of insurer 1'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.set_daily_rate(pol, date '2031-01-01', 5); raise exception 'fleet admin set rate'; exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.set_billing_rules(i1, date '2031-01-01', true, true, 'Europe/London', 2, 0); raise exception 'fleet admin set rules'; exception when sqlstate '42501' then n := n + 1; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_daily_rate(pol, date '2031-01-01', 5); n := n + 1;
  begin perform public.set_daily_rate(pol, date '2031-01-01', 6); raise exception 'duplicate date allowed'; exception when unique_violation then n := n + 1; end;
  begin perform public.set_daily_rate(pol, date '2031-02-01', -1); raise exception 'negative rate allowed'; exception when check_violation then n := n + 1; end;
  perform public.set_billing_rules(i1, date '2031-01-01', true, true, 'Europe/London', 2, 0); n := n + 1;
  begin perform public.set_billing_rules(i1, date '2031-02-01', true, true, 'Not/AZone', 2, 0); raise exception 'bad timezone allowed'; exception when sqlstate '22023' then n := n + 1; end;
  begin perform public.set_billing_rules('10000000-0000-4000-8000-000000000003', date '2031-01-01', true, true, 'Europe/London', 2, 0); raise exception 'other insurer rules allowed'; exception when sqlstate '42501' then n := n + 1; end;
  reset role;
  begin update public.rate_cards set daily_rate = 1 where policy_id = pol; raise exception 'rate edited'; exception when others then if sqlerrm like 'rate edited' then raise; end if; n := n + 1; end;
  raise exception 'RATES TESTS PASSED (% checks)', n;
end $$;
