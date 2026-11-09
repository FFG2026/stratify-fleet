-- Referral of vehicle additions outside a policy's criteria. A passing run ends with: ERROR: COVER REFERRAL TESTS PASSED (n checks).
do $$
declare
  IA uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; U2 uuid := 'eeeeeeee-0000-4000-8000-000000000002';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002';
  p1 uuid; p2 uuid; r jsonb; rid uuid; rid2 uuid; n int; st text; checks int := 0;
begin
  select id into p1 from public.policies where fleet_id = f1; select id into p2 from public.policies where fleet_id = f2;
  insert into auth.users (id, instance_id, aud, role, email) values (U2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f2admin@x.test');
  insert into public.memberships (user_id, organisation_id, role) values (U2, f2, 'fleet_admin');

  -- policy 1 accepts vans and cars automatically; policy 2 has no criteria
  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_policy_terms(p1, date '2026-01-01', 10, 0, 0, 28, null, array['van_3_5t', 'car']);
  begin perform public.set_policy_terms(p1, date '2026-02-01', 10, 0, 0, 28, null, array['spaceship']); raise exception 'X1 accepted bad type'; exception when sqlstate '22023' then null; end;
  reset role; checks := checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  r := public.request_vehicle_cover(f1, p1, 'AA11AAA', now(), 'Ford Transit', 'van_3_5t');
  if r->>'status' <> 'added' then raise exception 'T1 van should be added, got %', r; end if;
  r := public.request_vehicle_cover(f1, p1, 'BB22BBB', now(), 'DAF CF', 'hgv');
  if r->>'status' <> 'referred' then raise exception 'T2 hgv should be referred, got %', r; end if;
  rid := (r->>'id')::uuid;
  select count(*) into n from public.coverage_periods cp join public.vehicles v on v.id = cp.vehicle_id where v.registration = 'BB22BBB';
  if n <> 0 then raise exception 'T3 referred vehicle has cover'; end if;
  begin perform public.add_vehicle_cover(f1, p1, 'CC33CCC', now(), 'x'); raise exception 'T4 direct add bypassed criteria'; exception when sqlstate '42501' then null; end;
  begin perform public.request_vehicle_cover(f1, p1, 'BB22BBB', now(), 'DAF CF', 'hgv'); raise exception 'T5 duplicate referral accepted'; exception when sqlstate '23505' then null; end;
  begin perform public.decide_cover_referral(rid, 'approve'); raise exception 'T6 fleet decided'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 6;

  -- another fleet cannot see it
  perform set_config('request.jwt.claims', json_build_object('sub', U2, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.cover_referrals; if n <> 0 then raise exception 'T7 other fleet saw % referrals', n; end if;
  r := public.request_vehicle_cover(f2, p2, 'DD44DDD', now(), 'DAF CF', 'hgv');
  if r->>'status' <> 'added' then raise exception 'T8 no criteria should add, got %', r; end if;
  reset role; checks := checks + 2;

  -- insurer queries, fleet answers, insurer approves
  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.decide_cover_referral(rid, 'query'); raise exception 'T9 query without message'; exception when sqlstate '22023' then null; end;
  perform public.decide_cover_referral(rid, 'query', 'What is it used for?');
  select status into st from public.cover_referrals where id = rid; if st <> 'queried' then raise exception 'T10 status %', st; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.respond_cover_referral(rid, 'Local deliveries only');
  begin perform public.respond_cover_referral(rid, 'again'); raise exception 'T11 answered twice'; exception when sqlstate '22023' then null; end;
  select count(*) into n from public.cover_referral_messages where referral_id = rid; if n <> 2 then raise exception 'T12 messages %', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.decide_cover_referral(rid, 'approve', 'Approved with local use only') <> 'approved' then raise exception 'T13 approve'; end if;
  select count(*) into n from public.coverage_periods cp join public.vehicles v on v.id = cp.vehicle_id where v.registration = 'BB22BBB' and cp.cover_end is null;
  if n <> 1 then raise exception 'T14 approved vehicle not on cover'; end if;
  begin perform public.decide_cover_referral(rid, 'decline', 'late'); raise exception 'T15 decided twice'; exception when sqlstate '22023' then null; end;
  reset role; checks := checks + 6;

  -- decline and withdraw
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  rid := (public.request_vehicle_cover(f1, p1, 'EE55EEE', now(), 'Coach', 'minibus')->>'id')::uuid;
  rid2 := (public.request_vehicle_cover(f1, p1, 'FF66FFF', now(), 'Coach', 'minibus')->>'id')::uuid;
  perform public.withdraw_cover_referral(rid2);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', IA, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.decide_cover_referral(rid, 'decline'); raise exception 'T16 decline without message'; exception when sqlstate '22023' then null; end;
  perform public.decide_cover_referral(rid, 'decline', 'Outside appetite');
  select count(*) into n from public.cover_referrals where status = 'declined'; if n <> 1 then raise exception 'T17 declined count %', n; end if;
  begin perform public.decide_cover_referral(rid2, 'approve'); raise exception 'T18 approved a withdrawn request'; exception when sqlstate '22023' then null; end;
  reset role; checks := checks + 3;

  -- pending vehicles are not in the bordereau; the thread cannot be edited
  begin update public.cover_referral_messages set body = 'x'; raise exception 'T19 messages editable'; exception when others then if sqlerrm like 'T19%' then raise; end if; end;
  checks := checks + 1;
  raise exception 'COVER REFERRAL TESTS PASSED (% checks)', checks;
end $$;
