-- Audit feed and branding test. Rolls back.
do $$
declare
  P uuid := '1c6288ab-66cf-4beb-b31f-8cc6498d0da4'; I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  i1 uuid := '10000000-0000-4000-8000-000000000002'; i2 uuid := '10000000-0000-4000-8000-000000000003';
  n int := 0; c bigint; bad int; r record;
begin
  -- the platform admin sees entries of every organisation; the insurer admin only its own and its customers'
  perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  select max(total) into c from public.audit_feed(null, null, 5, 0); if coalesce(c, 0) = 0 then raise exception 'T1 platform sees nothing'; end if; n := n + 1;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into bad from public.audit_feed(null, null, 200, 0) f where f.organisation_id not in (select id from public.organisations where id = i1 or insurer_id = i1);
  if bad <> 0 then raise exception 'T2 insurer admin sees % foreign entries', bad; end if; n := n + 1;
  select count(*) into bad from public.audit_feed(i2, null, 200, 0); if bad <> 0 then raise exception 'T3 other insurer queried directly'; end if; n := n + 1;
  -- a driver has no audit permission
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into bad from public.audit_feed(null, null, 200, 0); if bad <> 0 then raise exception 'T4 driver sees audit'; end if; n := n + 1;
  -- branding: only platform admins can edit; insurers and fleets receive assigned branding
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated', 'aal', 'aal2')::text, true); set local role authenticated;
  perform public.set_branding(i1, 'Example Mutual Fleet', '#1A5C4B'); n := n + 1;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated', 'aal', 'aal2')::text, true); set local role authenticated;
  begin perform public.set_branding(i1, 'Nope', '#000000'); raise exception 'Insurer changed branding'; exception when sqlstate '42501' then n := n + 1;end;
  begin perform public.set_branding(i2, 'Nope', '#000000'); raise exception 'T5 other insurer branded'; exception when sqlstate '42501' then n := n + 1; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated', 'aal', 'aal2')::text, true);set local role authenticated;
  begin perform public.set_branding(i1, 'Bad', 'red'); raise exception 'T6 bad colour accepted'; exception when sqlstate '22023' then n := n + 1; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.set_branding(i1, 'Nope', '#000000'); raise exception 'T7 fleet admin branded'; exception when sqlstate '42501' then n := n + 1; end;
  select * into r from public.my_branding(); if r.display_name is distinct from 'Example Mutual Fleet' or r.accent is distinct from '#1A5C4B' then raise exception 'T8 customer does not see its insurer''s branding: %', r; end if; n := n + 1;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into bad from public.my_branding(); if bad <> 0 then raise exception 'T9 platform got branding'; end if; n := n + 1;
  reset role;
  if not exists (select 1 from public.audit_logs where action = 'branding.changed') then raise exception 'T10 branding change not audited'; end if; n := n + 1;
  raise exception 'AUDIT AND BRANDING TESTS PASSED (% checks)', n;
end $$;
