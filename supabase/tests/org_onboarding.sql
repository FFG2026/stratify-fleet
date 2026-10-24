-- Onboarding isolation test (insurers, customers, policies, renewal, change of insurer). Rolls back.
do $$
declare
  P uuid := '1c6288ab-66cf-4beb-b31f-8cc6498d0da4'; I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee';
  i1 uuid := '10000000-0000-4000-8000-000000000002'; i2 uuid := '10000000-0000-4000-8000-000000000003';
  n int := 0; ins uuid; cu uuid; pol uuid; pol2 uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  ins := public.create_insurer('Test Insurer Zed', 'zed-admin@example.test'); n := n + 1;
  begin perform public.create_insurer('  test insurer zed ', 'x@example.test'); raise exception 'dup insurer allowed'; exception when sqlstate '23505' then n := n + 1; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.create_insurer('Sneaky', 'y@example.test'); raise exception 'insurer admin created insurer'; exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.create_customer(i2, 'Not Mine Ltd', 'z@example.test'); raise exception 'created customer for other insurer'; exception when sqlstate '42501' then n := n + 1; end;
  cu := public.create_customer(i1, 'Test Customer Zed', 'cust-admin@example.test'); n := n + 1;
  pol := public.create_policy(cu, 'ZED-001', 'Test', current_date - 5, null); n := n + 1;
  begin perform public.create_policy(cu, 'ZED-001', null, current_date, null); raise exception 'dup policy allowed'; exception when sqlstate '23505' then n := n + 1; end;
  begin perform public.change_customer_insurer(cu, i2, 'test'); raise exception 'insurer admin moved customer'; exception when sqlstate '42501' then n := n + 1; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.create_customer(i1, 'Fleet Made', 'q@example.test'); raise exception 'fleet admin created customer'; exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.create_policy(cu, 'ZED-002', null, current_date, null); raise exception 'fleet admin created policy'; exception when sqlstate '42501' then n := n + 1; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.end_policy(pol, current_date - 1); n := n + 1;
  perform public.change_customer_insurer(cu, i2, 'test move'); n := n + 1;
  reset role;
  if not exists (select 1 from public.invitations where lower(email) = 'cust-admin@example.test') then raise exception 'first admin not invited'; end if; n := n + 1;
  raise exception 'ONBOARDING TESTS PASSED (% checks)', n;
end $$;
