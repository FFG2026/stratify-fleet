-- Driver integrity test: one active customer per driver, switch-off ends assignments, move resets permissions and hides records,
-- same registration cannot be on cover for two customers. Rolls back.
do $$
declare
  P uuid := '1c6288ab-66cf-4beb-b31f-8cc6498d0da4'; F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002';
  n int := 0; m uuid; veh uuid; demail text; c int; pol2 uuid; reg text; v2 uuid;
begin
  select id into m from public.memberships where user_id = D and organisation_id = f1 and role = 'driver' and active;
  if m is null then raise exception 'test needs D as an active driver of f1'; end if;
  select email into demail from auth.users where id = D;
  select id into veh from public.vehicles where fleet_id = f1 limit 1;
  insert into public.vehicle_assignments (fleet_id, vehicle_id, user_id, assigned_from) values (f1, veh, D, current_date - 3);
  insert into public.driver_documents (user_id, fleet_id, kind, storage_path, file_name, content_type, size_bytes) values (D, f1, 'other', f1 || '/' || D || '/itest.png', 'x.png', 'image/png', 10);
  insert into public.driver_consents (user_id, fleet_id, kind, given, version, statement) values (D, f1, 'licence_check', true, 'v1', 'test');
  -- fleet admin sees the driver while active
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into c from public.driver_profiles where user_id = D; if c <> 1 then raise exception 'T1 staff cannot see active driver'; end if; n := n + 1;
  perform public.set_member_active(m, false);
  select count(*) into c from public.driver_profiles where user_id = D; if c <> 0 then raise exception 'T2 staff still see switched-off driver'; end if; n := n + 1;
  select count(*) into c from public.driver_documents where user_id = D; if c <> 0 then raise exception 'T3 staff still see documents'; end if; n := n + 1;
  select count(*) into c from public.driver_consents where user_id = D; if c <> 0 then raise exception 'T4 staff still see consents'; end if; n := n + 1;
  reset role;
  select count(*) into c from public.vehicle_assignments where user_id = D and fleet_id = f1 and assigned_to is null; if c <> 0 then raise exception 'T5 assignment still open'; end if; n := n + 1;
  -- switching back on restores access; two active customers are refused
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_member_active(m, true);
  select count(*) into c from public.driver_profiles where user_id = D; if c <> 1 then raise exception 'T6 not visible again'; end if; n := n + 1;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.add_member(f2, demail, 'driver'); raise exception 'T7 second active customer allowed'; exception when sqlstate '23505' then n := n + 1; end;
  -- move: switch off at f1, add at f2
  reset role; update public.memberships set active = false where id = m;
  perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.add_member(f2, demail, 'driver') <> 'added' then raise exception 'T8 move not added'; end if; n := n + 1;
  reset role;
  if (select fleet_id from public.driver_profiles where user_id = D) <> f2 then raise exception 'T9 profile did not follow'; end if; n := n + 1;
  if exists (select 1 from public.driver_documents where user_id = D and fleet_id = f1 and deleted_at is null) then raise exception 'T10 old documents still live'; end if; n := n + 1;
  if (select given from public.driver_consent_current where user_id = D and kind = 'licence_check') then raise exception 'T11 licence consent carried over'; end if; n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into c from public.driver_profiles where user_id = D; if c <> 0 then raise exception 'T12 old customer still sees driver'; end if; n := n + 1;
  reset role;
  -- same registration on cover for two customers
  select v.registration into reg from public.vehicles v join public.coverage_periods p on p.vehicle_id = v.id where v.fleet_id = f1 and p.cover_end is null and p.voided_at is null limit 1;
  select id into pol2 from public.policies where fleet_id = f2 limit 1;
  if reg is not null and pol2 is not null then
    insert into public.vehicles (fleet_id, registration) values (f2, reg) returning id into v2;
    begin insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start) values (v2, f2, pol2, now()); raise exception 'T13 same registration covered twice';
    exception when sqlstate '23P01' then n := n + 1; end;
  end if;
  raise exception 'DRIVER INTEGRITY TESTS PASSED (% checks)', n;
end $$;
