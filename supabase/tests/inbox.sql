-- Insurer inbox assignment and first-touch. Runs inside one block that always ends by raising, so nothing is kept.
-- A passing run ends with: ERROR: INBOX TESTS PASSED (n checks). Any other message is a failure.
-- Uses the same dev fixtures as supabase/tests/claims.sql.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45';
  R uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; X uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  H uuid := 'aaaaaaaa-0000-4000-8000-000000000010';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002';
  i2 uuid := '10000000-0000-4000-8000-000000000003';
  vd uuid := '6da45364-78e4-4ebd-9ee4-4dd8f0ad66db';
  cid uuid; cid2 uuid; n int; t text; checks int := 0; path text; hid uuid; hemail text; touched timestamptz; ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (R, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r@x.test'),
    (X, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@x.test'),
    (H, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'handler@x.test');
  insert into public.memberships (user_id, organisation_id, role, active) values
    (R, f2, 'fleet_admin', true), (X, i2, 'insurer_admin', true), (H, (select insurer_id from public.organisations where id = f1), 'insurer_claims', true);

  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  cid := public.report_claim(null, vd, null, null, null, now() - interval '1 hour', 'A1 near Leeds', 'Another car reversed into the side of the van.', false, null, false, null, true, false);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  path := f1 || '/' || cid || '/' || gen_random_uuid() || '.png';
  perform public.add_claim_attachment(cid, null, 'photo', path, 'damage.png', 'image/png', 1234, 'Rear wing');
  perform public.assess_claim(cid, 'Looks right.', false);
  perform public.submit_claim(cid);
  begin perform public.assign_claim_handler(cid, H); raise exception 'T1 fleet assigned'; exception when sqlstate '42501' then null; end;
  begin perform public.list_claim_handlers(cid); raise exception 'T2 fleet listed handlers'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 2;

  foreach t in array array[D::text, R::text, X::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    begin perform public.assign_claim_handler(cid, I); raise exception 'T3 % assigned', t; exception when sqlstate '42501' then null; end;
    begin perform public.list_claim_handlers(cid); raise exception 'T3b % listed handlers', t; exception when sqlstate '42501' then null; end;
    reset role; checks := checks + 2;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.list_claim_handlers(cid);
  if n < 2 then raise exception 'T4 handler list missing colleagues (%)', n; end if;
  if not exists (select 1 from public.list_claim_handlers(cid) where user_id = H and email = 'handler@x.test') then raise exception 'T5 claims handler missing'; end if;
  if exists (select 1 from public.list_claim_handlers(cid) where user_id = F) then raise exception 'T6 fleet on handler list'; end if;
  begin perform public.assign_claim_handler(cid, F); raise exception 'T7 assigned to the fleet'; exception when sqlstate '22023' then null; end;
  perform public.assign_claim_handler(cid, H);
  select handler_id, handler_email, first_touched_at into hid, hemail, touched from public.claim_handling where claim_id = cid;
  if hid <> H or hemail <> 'handler@x.test' then raise exception 'T8 assign did not stick'; end if;
  if touched is not null then raise exception 'T9 assigning to a colleague stamped first touch'; end if;
  perform public.start_claim_review(cid, 'EM-INBOX');
  select handler_id, first_touched_at into hid, touched from public.claim_handling where claim_id = cid;
  if hid <> H then raise exception 'T10 start review stole an assigned claim'; end if;
  if touched is null then raise exception 'T11 start review did not stamp first touch'; end if;
  perform public.assign_claim_handler(cid, null);
  select handler_id, first_touched_at into hid, touched from public.claim_handling where claim_id = cid;
  if hid is not null then raise exception 'T12 unassign left a handler'; end if;
  if touched is null then raise exception 'T13 unassign cleared first touch'; end if;
  perform public.start_claim_review(cid, null);
  select handler_id into hid from public.claim_handling where claim_id = cid;
  if hid <> I then raise exception 'T14 start review did not take an unassigned claim'; end if;
  select count(*) into n from public.claim_events where claim_id = cid and kind = 'handler_assigned' and visibility = 'insurer';
  if n < 2 then raise exception 'T15 assignment events missing (%)', n; end if;
  reset role; checks := checks + 12;

  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_events where claim_id = cid and kind = 'handler_assigned';
  if n <> 0 then raise exception 'T16 fleet sees assignment events'; end if;
  select count(*) into n from public.claim_handling where claim_id = cid;
  if n <> 0 then raise exception 'T20 fleet can read the handler details (%)', n; end if;
  begin insert into public.claim_handling (claim_id, handler_id, handler_email, assigned_at) values (cid, F, 'f@x.test', now()); raise exception 'T21 fleet wrote handler details'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 3;
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_handling;
  if n <> 0 then raise exception 'T22 driver can read handler details (%)', n; end if;
  reset role; checks := checks + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  cid2 := public.log_insurer_claim(f1, null, 'ZZ99ABC', D, null, now() - interval '2 days', 'M62 junction 26', 'Third party reported a collision with our insured van.', false, null, false, null, 'EM-INBOX-2');
  select handler_id, first_touched_at is not null into hid, ok from public.claim_handling where claim_id = cid2;
  if hid <> I or not ok then raise exception 'T17 logged claim not taken by the logger'; end if;
  perform public.close_claim(cid2, 'no_claim_pursued', 'Opened in error for the inbox test.');
  begin perform public.assign_claim_handler(cid2, H); raise exception 'T18 assigned a closed claim'; exception when sqlstate '22023' then null; end;
  begin update public.claim_handling set handler_id = H, handler_email = 'x', assigned_at = now() where claim_id = cid; raise exception 'T19 direct handler update'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 3;

  raise exception 'INBOX TESTS PASSED (% checks)', checks;
end $$;
