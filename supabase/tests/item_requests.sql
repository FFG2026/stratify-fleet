-- Insurer requests for specific photos/documents. Runs in one block that always ends by raising, so nothing is kept.
-- A passing run ends with: ERROR: ITEM REQUEST TESTS PASSED (n checks). Any other message is a failure.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45';
  R uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002';
  vd uuid := '6da45364-78e4-4ebd-9ee4-4dd8f0ad66db';
  cid uuid; rid uuid; n int; checks int := 0; path text; att uuid; i1 uuid; i2 uuid; st text;
begin
  insert into auth.users (id, instance_id, aud, role, email) values (R, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r@x.test');
  insert into public.memberships (user_id, organisation_id, role, active) values (R, f2, 'fleet_admin', true);

  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  cid := public.report_claim(null, vd, null, null, null, now() - interval '1 hour', 'A1 near Leeds', 'Another car reversed into the side of the van.', false, null, false, null, true, false);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  path := f1 || '/' || cid || '/' || gen_random_uuid() || '.png';
  perform public.add_claim_attachment(cid, null, 'photo', path, 'damage.png', 'image/png', 1234, 'Rear wing');
  perform public.assess_claim(cid, 'Looks right.', false);
  perform public.submit_claim(cid);
  begin perform public.request_claim_items(cid, '[{"kind":"photos"}]'::jsonb, null, null); raise exception 'T1 fleet requested items'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.request_claim_items(cid, '[]'::jsonb, null, null); raise exception 'T2 empty accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.request_claim_items(cid, '[{"kind":"photos"},{"kind":"photos"}]'::jsonb, null, null); raise exception 'T3 duplicate accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.request_claim_items(cid, '[{"kind":"other"}]'::jsonb, null, null); raise exception 'T4 other without label'; exception when sqlstate '22023' then null; end;
  begin perform public.request_claim_items(cid, '[{"kind":"bogus"}]'::jsonb, null, null); raise exception 'T5 unknown kind'; exception when sqlstate '22023' then null; end;
  rid := public.request_claim_items(cid, '[{"kind":"photos"},{"kind":"estimate"}]'::jsonb, 'Rear bumper please', null);
  reset role; checks := checks + 5;

  select status into st from public.claims where id = cid;
  if st <> 'awaiting_information' then raise exception 'T6 status %', st; end if; checks := checks + 1;

  -- Another fleet cannot see the items
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_request_items where claim_id = cid;
  if n <> 0 then raise exception 'T7 other fleet saw % items', n; end if;
  reset role; checks := checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_request_items where claim_id = cid;
  if n <> 2 then raise exception 'T8 fleet saw % items', n; end if;
  begin insert into public.claim_request_items (request_id, claim_id, fleet_id, kind) values (rid, cid, f1, 'photos'); raise exception 'T9 direct insert'; exception when insufficient_privilege then null; end;
  begin update public.claim_request_items set fulfilled_at = now() where claim_id = cid; raise exception 'T10 direct update'; exception when insufficient_privilege then null; end;
  select id into i1 from public.claim_request_items where claim_id = cid and kind = 'photos';
  select id into i2 from public.claim_request_items where claim_id = cid and kind = 'estimate';
  begin perform public.fulfil_request_item(i1, null, null); raise exception 'T11 empty fulfil'; exception when sqlstate '22023' then null; end;
  perform public.fulfil_request_item(i2, null, 'Garage has not quoted yet.');
  begin perform public.fulfil_request_item(i2, null, 'again'); raise exception 'T12 fulfilled twice'; exception when sqlstate '22023' then null; end;
  path := f1 || '/' || cid || '/' || gen_random_uuid() || '.png';
  att := public.add_claim_attachment(cid, rid, 'photo', path, 'rear.png', 'image/png', 1234, null);
  perform public.fulfil_request_item(i1, att, null);
  reset role; checks := checks + 6;

  select status into st from public.claims where id = cid;
  if st = 'awaiting_information' then raise exception 'T13 still waiting after all items done'; end if;
  if not exists (select 1 from public.claim_requests where id = rid and answered_at is not null) then raise exception 'T14 request not answered'; end if;
  checks := checks + 2;

  -- Driver cannot fulfil
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  rid := public.request_claim_items(cid, '[{"kind":"other","label":"Dashcam footage"}]'::jsonb, null, null);
  reset role;
  select id into i1 from public.claim_request_items where request_id = rid;
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.fulfil_request_item(i1, null, 'nope'); raise exception 'T15 driver fulfilled'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 1;

  raise exception 'ITEM REQUEST TESTS PASSED (% checks)', checks;
end $$;
