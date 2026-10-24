-- Two-factor enforcement test. Rolls back.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; n int := 0; c int;
begin
  -- no factor: normal access
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated', 'aal', 'aal1')::text, true); set local role authenticated;
  select count(*) into c from public.vehicles; if c = 0 then raise exception 'T1 no access without a factor'; end if; n := n + 1;
  reset role;
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values (gen_random_uuid(), F, 'test', 'totp', 'verified', now(), now());
  -- verified factor, session only at aal1: nothing visible, functions refuse
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated', 'aal', 'aal1')::text, true); set local role authenticated;
  select count(*) into c from public.vehicles; if c <> 0 then raise exception 'T2 aal1 session sees vehicles'; end if; n := n + 1;
  select count(*) into c from public.coverage_periods; if c <> 0 then raise exception 'T3 aal1 session sees cover'; end if; n := n + 1;
  begin perform public.add_member('20000000-0000-4000-8000-000000000001', 'someone@example.test', 'fleet_manager'); raise exception 'T4 aal1 function call allowed'; exception when sqlstate '42501' then n := n + 1; end;
  -- after the second step: normal access
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated', 'aal', 'aal2')::text, true); set local role authenticated;
  select count(*) into c from public.vehicles; if c = 0 then raise exception 'T5 aal2 session blocked'; end if; n := n + 1;
  -- another person is unaffected
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated', 'aal', 'aal1')::text, true); set local role authenticated;
  select count(*) into c from public.coverage_periods; if c = 0 then raise exception 'T6 other user blocked'; end if; n := n + 1;
  raise exception 'MFA TESTS PASSED (% checks)', n;
end $$;
