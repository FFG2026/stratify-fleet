-- National driver search isolation test. Runs as real principals inside a transaction that always rolls back.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed'; I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45';
  n int := 0; r jsonb; nm text; ok boolean;
begin
  select full_name into nm from public.driver_profiles where user_id = D;
  if nm is null then raise exception 'test needs a driver profile for D'; end if;
  nm := substr(nm, 1, 4);
  -- driver has not opted in: insurer finds nothing
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  r := public.search_national_drivers(nm); n := n + 1; if jsonb_array_length(r) <> 0 then raise exception 'T1 not opted in but found: %', r; end if;
  -- short name refused
  begin perform public.search_national_drivers('ab'); raise exception 'T2 short name allowed'; exception when sqlstate '22023' then n := n + 1; end;
  -- fleet admin may not search
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.search_national_drivers(nm); raise exception 'T3 fleet admin searched'; exception when sqlstate '42501' then n := n + 1; end;
  -- driver opts in
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.record_driver_consent('national_database', true, 'v1', 'test wording');
  -- insurer now finds the driver, DOB hidden unless supplied
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  r := public.search_national_drivers(nm); n := n + 1; if jsonb_array_length(r) < 1 then raise exception 'T4 opted in but not found'; end if;
  if r->0->>'date_of_birth' is not null then raise exception 'T5 date of birth leaked without being supplied'; end if; n := n + 1;
  r := public.national_driver_file(D); n := n + 1; if r->>'full_name' is null then raise exception 'T6 no file'; end if;
  -- the insurer cannot read the driver's rows directly
  -- audit trail written
  reset role;
  -- a driver switched off everywhere is still found (no current customer) and can still withdraw
  update public.driver_consents set recorded_at = now() - interval '1 minute' where user_id = D and kind = 'national_database';
  update public.memberships set active = false where user_id = D and role = 'driver';
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  r := public.search_national_drivers(nm); n := n + 1; if jsonb_array_length(r) < 1 or r->0->>'fleet_name' is not null then raise exception 'T6b former driver wrong: %', r; end if;
  reset role;
  select count(*) > 0 into ok from public.audit_logs where action = 'driver.national_search' and actor_id = I; n := n + 1; if not ok then raise exception 'T7 search not audited'; end if;
  select count(*) > 0 into ok from public.audit_logs where action = 'driver.national_viewed' and actor_id = I and entity_id = D; n := n + 1; if not ok then raise exception 'T8 view not audited'; end if;
  -- driver withdraws: gone at once
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.record_driver_consent('national_database', false, 'v1', 'test wording');
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  r := public.search_national_drivers(nm); n := n + 1; if jsonb_array_length(r) <> 0 then raise exception 'T9 withdrawn but still found'; end if;
  begin perform public.national_driver_file(D); raise exception 'T10 withdrawn file opened'; exception when sqlstate '42501' then n := n + 1; end;
  -- an ordinary table read cannot see national consent of other fleets' drivers beyond RLS (insurer has no crm.read)
  reset role;
  select count(*) = 0 into ok from public.role_permissions where role = 'insurer_admin' and permission = 'crm.read'; n := n + 1; if not ok then raise exception 'T11 insurer still has crm.read'; end if;
  raise exception 'NATIONAL SEARCH TESTS PASSED (% checks)', n;
end $$;
