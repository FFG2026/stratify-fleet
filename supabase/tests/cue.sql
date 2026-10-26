-- CUE queue test. Runs inside one block that always ends by raising, so nothing is kept.
-- A passing run ends with: ERROR: CUE TESTS PASSED (n checks). Any other message is a failure.
-- Uses the same dev fixtures as supabase/tests/claims.sql.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; P uuid := '1c6288ab-66cf-4beb-b31f-8cc6498d0da4';
  R uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; X uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002'; i2 uuid := '10000000-0000-4000-8000-000000000003';
  vd uuid := '6da45364-78e4-4ebd-9ee4-4dd8f0ad66db';
  cid uuid; cid2 uuid; sid uuid; sid2 uuid; n int; t text; checks int := 0; pl jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (R, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r@x.test'),
    (X, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@x.test');
  insert into public.memberships (user_id, organisation_id, role, active) values (R, f2, 'fleet_admin', true), (X, i2, 'insurer_admin', true);

  ---- the fleet reports a claim with an injury, a third party and a witness, reviews it, but does not send it yet
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  cid := public.report_claim(f1, vd, null, D, null, now() - interval '2 hours', 'A1 near Leeds', 'Another car reversed into the side of the van.', true, 'Driver had a sore neck.', true, 'POL123', true, true);
  perform public.add_claim_party(cid, 'third_party', 'Pat Other', '07700900123', 'ZZ99 ZZZ', 'Other Insurance Ltd', null, null);
  perform public.add_claim_party(cid, 'witness', 'Wendy Witness', '07700900456', null, null, null, null);
  perform public.assess_claim(cid, null, true);
  begin perform public.queue_cue_submission(cid); raise exception 'T1 fleet queued CUE'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  reset role;

  ---- an insurer cannot queue a claim that has not been sent
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.queue_cue_submission(cid); raise exception 'T2 queued an unsent claim'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  reset role;

  ---- send it
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.submit_claim(cid);
  reset role;

  ---- the others cannot queue it
  foreach t in array array[D::text, R::text, X::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    begin perform public.queue_cue_submission(cid); raise exception 'T3 % queued CUE', t; exception when sqlstate '42501' then null; end;
    reset role; checks := checks + 1;
  end loop;

  ---- the insurer queues it with one call
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  sid := public.queue_cue_submission(cid); checks := checks + 1;
  select payload into pl from public.cue_submissions where id = sid;
  if pl is null then raise exception 'T4 insurer cannot read its own record'; end if; checks := checks + 1;
  if (select version from public.cue_submissions where id = sid) <> 1 or (select submission_status from public.cue_submissions where id = sid) <> 'queued' then
    raise exception 'T5 wrong version or status'; end if; checks := checks + 1;
  if pl #>> '{vehicle,registration}' is null or pl #>> '{claim,reference}' is null then raise exception 'T6 payload missing registration or reference'; end if; checks := checks + 1;
  if (pl #>> '{incident,injury_reported}')::boolean is not true then raise exception 'T7 injury flag lost'; end if; checks := checks + 1;
  if jsonb_array_length(pl -> 'third_parties') <> 1 or (pl ->> 'witness_count')::int <> 1 then raise exception 'T8 parties wrong'; end if; checks := checks + 1;
  -- minimisation: no narrative, no injury text, no phone numbers, no witness name
  if pl::text ilike '%reversed into%' or pl::text ilike '%sore neck%' or pl::text like '%07700900%' or pl::text ilike '%Wendy%' then
    raise exception 'T9 payload leaks narrative, injury text, phone or witness name'; end if; checks := checks + 1;
  -- pressing again with nothing changed is refused
  begin perform public.queue_cue_submission(cid); raise exception 'T10 duplicate queued'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  -- a direct write is refused
  begin insert into public.cue_submissions (claim_id, fleet_id, insurer_id, version, payload, created_by) select claim_id, fleet_id, insurer_id, 2, '{}'::jsonb, created_by from public.cue_submissions where id = sid;
    raise exception 'T11 direct insert allowed'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  begin update public.cue_submissions set submission_status = 'accepted' where id = sid; raise exception 'T12 direct update allowed'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  perform public.log_cue_download(sid); checks := checks + 1;
  reset role;

  ---- a change to the claim produces version 2 and keeps version 1
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.start_claim_review(cid, 'INS-777');
  sid2 := public.queue_cue_submission(cid);
  if (select version from public.cue_submissions where id = sid2) <> 2 then raise exception 'T13 second version wrong'; end if;
  if (select count(*) from public.cue_submissions where claim_id = cid) <> 2 then raise exception 'T14 earlier version lost'; end if;
  if (select payload #>> '{claim,insurer_reference}' from public.cue_submissions where id = sid2) <> 'INS-777' then raise exception 'T15 new reference missing'; end if;
  reset role; checks := checks + 3;

  ---- who can read the records
  foreach t in array array[F::text, D::text, R::text, X::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    select count(*) into n from public.cue_submissions where claim_id = cid; if n <> 0 then raise exception 'T16 % can read CUE records', t; end if;
    begin perform public.log_cue_download(sid); raise exception 'T17 % logged a download', t; exception when sqlstate '42501' then null; end;
    select count(*) into n from public.claim_events where claim_id = cid and kind = 'cue_queued'; if n <> 0 then raise exception 'T18 % can see CUE events', t; end if;
    reset role; checks := checks + 3;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.cue_submissions where claim_id = cid; if n <> 2 then raise exception 'T19 platform admin sees % records', n; end if;
  reset role; checks := checks + 1;

  ---- the insurer sees its own event, and the audit trail records what happened
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_events where claim_id = cid and kind = 'cue_queued' and visibility = 'insurer'; if n <> 2 then raise exception 'T20 insurer sees % CUE events', n; end if;
  reset role; checks := checks + 1;
  select count(*) into n from public.audit_logs where entity_id = cid and action = 'claim.cue_queued'; if n <> 2 then raise exception 'T21 queue audit entries (%)', n; end if;
  select count(*) into n from public.audit_logs where entity_id = cid and action = 'claim.cue_downloaded'; if n <> 1 then raise exception 'T22 download audit entries (%)', n; end if;
  checks := checks + 2;
  raise exception 'CUE TESTS PASSED (% checks)', checks;
end $$;
