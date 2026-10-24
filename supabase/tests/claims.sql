-- Claims isolation and workflow test. Runs inside one block that always ends by raising, so nothing is kept.
-- A passing run ends with: ERROR: CLAIMS TESTS PASSED (n checks). Any other message is a failure.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; P uuid := '1c6288ab-66cf-4beb-b31f-8cc6498d0da4';
  R uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; X uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  D2 uuid := 'aaaaaaaa-0000-4000-8000-000000000003'; A uuid := 'aaaaaaaa-0000-4000-8000-000000000004';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002'; f3 uuid := '20000000-0000-4000-8000-000000000003';
  i1 uuid := '10000000-0000-4000-8000-000000000002'; i2 uuid := '10000000-0000-4000-8000-000000000003';
  vd uuid := '6da45364-78e4-4ebd-9ee4-4dd8f0ad66db'; vother uuid := 'b72eccef-b653-4b98-b713-a880c4646d02';
  cid uuid; cid2 uuid; cid3 uuid; rid uuid; aid uuid; n int; t text; checks int := 0; path text; path2 text; ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (R, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r@x.test'),
    (X, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@x.test'),
    (D2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd2@x.test'),
    (A, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@x.test');
  insert into public.memberships (user_id, organisation_id, role, active) values
    (R, f2, 'fleet_admin', true), (X, i2, 'insurer_admin', true), (D2, f1, 'driver', true), (A, f1, 'fleet_accounts', true);

  ---- the driver reports
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  cid := public.report_claim(null, vd, null, null, null, now() - interval '1 hour', 'A1 near Leeds', 'Another car reversed into the side of the van.', false, null, false, null, true, false);
  checks := checks + 1;
  begin perform public.report_claim(null, vother, null, null, null, now() - interval '1 hour', 'A1', 'A vehicle that is not mine was hit.', false, null, false, null, true, false); raise exception 'T1 unassigned vehicle accepted';
  exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.report_claim(null, vd, null, null, null, now() - interval '1 hour', 'A1', 'Description long enough here.', null, null, false, null, true, false); raise exception 'T2 injury answer optional';
  exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.report_claim(null, vd, null, null, null, now() - interval '1 hour', 'A1', 'Description long enough here.', true, '', false, null, true, false); raise exception 'T3 injury details optional';
  exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.report_claim(null, vd, null, null, null, now() + interval '2 days', 'A1', 'Description long enough here.', false, null, false, null, true, false); raise exception 'T4 future accepted';
  exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin insert into public.claims (reference, fleet_id, insurer_id, registration, origin, reported_by, incident_at, location, description, anyone_injured) values ('X', f1, i1, 'AB1', 'driver', D, now(), 'xx', 'xxxxxxxxxxxx', false); raise exception 'T5 direct insert allowed';
  exception when sqlstate '42501' then null; end; checks := checks + 1;
  select count(*) into n from public.claims where id = cid; if n <> 1 then raise exception 'T6 driver cannot see own claim'; end if; checks := checks + 1;
  begin perform public.submit_claim(cid); raise exception 'T7 driver sent a claim'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  begin perform public.assess_claim(cid, null, true); raise exception 'T7b driver reviewed a claim'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  reset role;

  ---- who can see a report that has not been sent
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims where id = cid; if n <> 1 then raise exception 'T8 fleet admin cannot see the report'; end if; checks := checks + 1;
  select count(*) into n from public.my_notifications where claim_id = cid and kind = 'claim_reported'; if n <> 1 then raise exception 'T9 fleet not notified (%)', n; end if; checks := checks + 1;
  reset role;
  foreach t in array array[I::text, P::text, R::text, X::text, D2::text, A::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    select count(*) into n from public.claims where id = cid; if n <> 0 then raise exception 'T10 % can see an unsent report', t; end if;
    select count(*) into n from public.claim_events where claim_id = cid; if n <> 0 then raise exception 'T10b % can see events', t; end if;
    select count(*) into n from public.my_notifications where claim_id = cid; if n <> 0 then raise exception 'T10c % can see notifications', t; end if;
    reset role; checks := checks + 3;
  end loop;

  ---- review and send
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.submit_claim(cid); raise exception 'T11 sent without review'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.assess_claim(cid, null, false); raise exception 'T12 reviewed without photos'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  path := f1 || '/' || cid || '/' || gen_random_uuid() || '.png';
  begin perform public.add_claim_attachment(cid, null, 'photo', f1 || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.png', 'a.png', 'image/png', 100, null); raise exception 'T13 wrong folder accepted';
  exception when sqlstate '42501' then null; end; checks := checks + 1;
  aid := public.add_claim_attachment(cid, null, 'photo', path, 'damage.png', 'image/png', 1234, 'Rear wing'); checks := checks + 1;
  select private.can_upload_claim_file(f1 || '/' || cid || '/' || gen_random_uuid() || '.jpg') into ok; if not ok then raise exception 'T14 fleet cannot upload'; end if; checks := checks + 1;
  perform public.assess_claim(cid, 'Looks right.', false); checks := checks + 1;
  perform public.update_claim_details(cid, vd, null, now() - interval '2 hours', 'A1 near Leeds', 'Another car reversed into the side of the van.', false, null, false, null, true, false);
  select assessed_at is null into ok from public.claims where id = cid; if not ok then raise exception 'T15 editing did not reset the review'; end if; checks := checks + 1;
  begin perform public.submit_claim(cid); raise exception 'T16 sent after an edit without a fresh review'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  perform public.assess_claim(cid, 'Looks right.', false);
  select count(*) into n from public.claim_events where claim_id = cid and kind = 'assessed'; if n <> 1 then raise exception 'T17 fleet cannot see its own internal event'; end if; checks := checks + 1;
  perform public.submit_claim(cid); checks := checks + 1;
  begin perform public.update_claim_details(cid, vd, null, now() - interval '2 hours', 'A1', 'Changed after sending to the insurer!', false, null, false, null, true, false); raise exception 'T18 edit after sending';
  exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.remove_claim_attachment(aid); raise exception 'T19 evidence removed after sending'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  select private.can_delete_claim_file(path) into ok; if ok then raise exception 'T20 evidence file deletable'; end if; checks := checks + 1;
  reset role;

  ---- driver after sending
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims where id = cid and status = 'submitted'; if n <> 1 then raise exception 'T21 driver cannot follow own claim'; end if;
  select count(*) into n from public.claim_events where claim_id = cid and visibility <> 'shared'; if n <> 0 then raise exception 'T22 driver sees internal events'; end if;
  select count(*) into n from public.claim_attachments where claim_id = cid; if n <> 1 then raise exception 'T22b driver cannot see files'; end if;
  select private.can_upload_claim_file(f1 || '/' || cid || '/' || gen_random_uuid() || '.jpg') into ok; if ok then raise exception 'T23 driver can still upload'; end if;
  begin perform public.update_claim_details(cid, vd, null, now() - interval '2 hours', 'A1', 'Changed after sending to the insurer!', false, null, false, null, true, false); raise exception 'T24 driver edit after sending';
  exception when sqlstate '22023' or sqlstate '42501' then null; end;
  reset role; checks := checks + 5;

  ---- the insurer
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims where id = cid; if n <> 1 then raise exception 'T25 insurer cannot see sent claim'; end if;
  select count(*) into n from public.claim_events where claim_id = cid and visibility = 'fleet'; if n <> 0 then raise exception 'T26 insurer sees fleet-internal events'; end if;
  select count(*) into n from public.my_notifications where claim_id = cid and kind = 'claim_submitted'; if n <> 1 then raise exception 'T27 insurer not notified'; end if;
  select count(*) into n from public.claim_attachments where claim_id = cid; if n <> 1 then raise exception 'T27b insurer cannot see photos'; end if;
  select private.can_read_claim_file(path) into ok; if not ok then raise exception 'T27c insurer cannot read the photo'; end if;
  begin perform public.add_claim_party(cid, 'witness', 'Wendy', null, null, null, null, null); raise exception 'T28 insurer added a party'; exception when sqlstate '42501' then null; end;
  perform public.start_claim_review(cid, 'EM-123'); 
  select count(*) into n from public.claims where id = cid and status = 'under_review' and insurer_reference = 'EM-123'; if n <> 1 then raise exception 'T29 review not started'; end if;
  rid := public.request_claim_info(cid, 'Please send the dashcam footage details.', current_date + 7);
  select count(*) into n from public.claims where id = cid and status = 'awaiting_information'; if n <> 1 then raise exception 'T30 status not awaiting information'; end if;
  perform public.add_claim_note(cid, 'Internal: check policy wording.', true);
  path2 := f1 || '/' || cid || '/' || gen_random_uuid() || '.pdf';
  perform public.add_claim_attachment(cid, null, 'document', path2, 'form.pdf', 'application/pdf', 500, 'Form to complete');
  reset role; checks := checks + 10;

  ---- fleet sees the request and answers; others cannot
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_requests where id = rid and answered_at is null; if n <> 1 then raise exception 'T31 fleet cannot see the request'; end if;
  select count(*) into n from public.claim_events where claim_id = cid and kind = 'note'; if n <> 0 then raise exception 'T32 fleet sees insurer-internal note'; end if;
  select count(*) into n from public.my_notifications where claim_id = cid and kind = 'info_requested'; if n <> 1 then raise exception 'T33 fleet not notified of request'; end if;
  begin perform public.request_claim_info(cid, 'I am the fleet', null); raise exception 'T34 fleet asked a question'; exception when sqlstate '42501' then null; end;
  begin perform public.close_claim(cid, 'settled', 'nope nope'); raise exception 'T35 fleet closed a sent claim'; exception when sqlstate '42501' then null; end;
  perform public.add_claim_note(cid, 'Fleet internal remark.', true);
  perform public.add_claim_attachment(cid, rid, 'photo', f1 || '/' || cid || '/' || gen_random_uuid() || '.jpg', 'dashcam.jpg', 'image/jpeg', 900, null);
  perform public.respond_claim_request(rid, 'Footage attached; the camera was facing forward.');
  begin perform public.respond_claim_request(rid, 'again'); raise exception 'T36 answered twice'; exception when sqlstate '22023' then null; end;
  select count(*) into n from public.claims where id = cid and status = 'under_review'; if n <> 1 then raise exception 'T37 status not back to under review'; end if;
  reset role; checks := checks + 7;
  foreach t in array array[D::text, D2::text, A::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    begin perform public.respond_claim_request(rid, 'x'); raise exception 'T38 % answered', t; exception when sqlstate '42501' or sqlstate '22023' then null; end;
    begin perform public.add_claim_note(cid, 'hello', false); raise exception 'T38b % wrote a note', t; exception when sqlstate '42501' then null; end;
    reset role; checks := checks + 2;
  end loop;

  ---- other tenants see nothing and cannot act
  foreach t in array array[R::text, X::text, D2::text, A::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    select count(*) into n from public.claims where id = cid; if n <> 0 then raise exception 'T39 % sees the claim', t; end if;
    select count(*) into n from public.claim_attachments where claim_id = cid; if n <> 0 then raise exception 'T39b % sees files', t; end if;
    select count(*) into n from public.claim_requests where claim_id = cid; if n <> 0 then raise exception 'T39c % sees requests', t; end if;
    select private.can_read_claim_file(path) into ok; if ok then raise exception 'T39d % can read the photo', t; end if;
    begin perform public.request_claim_info(cid, 'let me in', null); raise exception 'T40 % asked a question', t; exception when sqlstate '42501' then null; end;
    begin perform public.close_claim(cid, 'settled', 'closing it'); raise exception 'T41 % closed the claim', t; exception when sqlstate '42501' then null; end;
    reset role; checks := checks + 6;
  end loop;

  ---- platform administrators see sent claims (support) but not unsent reports
  perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims where id = cid; if n <> 1 then raise exception 'T42 platform cannot see sent claim'; end if; reset role; checks := checks + 1;

  ---- closing, reopening
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.close_claim(cid, 'settled', 'Paid and finished.');
  select count(*) into n from public.claims where id = cid and status = 'closed' and outcome = 'settled'; if n <> 1 then raise exception 'T43 not closed'; end if;
  begin perform public.add_claim_attachment(cid, null, 'photo', f1 || '/' || cid || '/' || gen_random_uuid() || '.jpg', 'x.jpg', 'image/jpeg', 10, null); raise exception 'T44 file added to a closed claim'; exception when sqlstate '42501' then null; end;
  begin perform public.request_claim_info(cid, 'one more thing', null); raise exception 'T45 question on closed claim'; exception when sqlstate '22023' then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.my_notifications where claim_id = cid and kind = 'claim_closed'; if n <> 1 then raise exception 'T46 fleet not told of closure'; end if;
  begin perform public.reopen_claim(cid, 'please reopen'); raise exception 'T47 fleet reopened'; exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.my_notifications where claim_id = cid and kind = 'claim_closed'; if n <> 1 then raise exception 'T48 driver not told of closure'; end if; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.reopen_claim(cid, 'New evidence arrived.');
  select count(*) into n from public.claims where id = cid and status = 'under_review' and closed_at is null; if n <> 1 then raise exception 'T49 not reopened'; end if;
  reset role; checks := checks + 7;

  ---- a claim logged by the insurer
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  cid2 := public.log_insurer_claim(f1, null, 'ZZ99ABC', D, null, now() - interval '3 days', 'M62 junction 26', 'Third party reported a collision with our insured van.', true, 'Passenger neck pain', true, 'PC-9981', 'EM-777');
  begin perform public.log_insurer_claim(f3, null, 'ZZ99ABC', null, null, now() - interval '3 days', 'M62', 'A fleet that this insurer does not insure.', false, null, null, null, null); raise exception 'T50 logged for another insurer''s fleet';
  exception when sqlstate '42501' then null; end;
  select count(*) into n from public.claims where id = cid2 and status = 'under_review' and origin = 'insurer'; if n <> 1 then raise exception 'T51 insurer cannot see own logged claim'; end if;
  reset role; checks := checks + 2;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims where id = cid2; if n <> 1 then raise exception 'T52 fleet cannot see insurer-logged claim'; end if;
  select count(*) into n from public.my_notifications where claim_id = cid2 and kind = 'claim_logged'; if n <> 1 then raise exception 'T53 fleet not notified of insurer-logged claim'; end if;
  perform public.add_claim_attachment(cid2, null, 'photo', f1 || '/' || cid2 || '/' || gen_random_uuid() || '.jpg', 'scene.jpg', 'image/jpeg', 50, null);
  perform public.mark_notifications_read(null);
  select count(*) into n from public.my_notifications where read_at is null; if n <> 0 then raise exception 'T54 notifications not marked read'; end if;
  reset role; checks := checks + 4;
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.my_notifications where claim_id = cid2 and kind = 'claim_logged'; if n <> 1 then raise exception 'T55 driver not notified'; end if;
  reset role;
  foreach t in array array[R::text, X::text, D2::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    select count(*) into n from public.claims where id = cid2; if n <> 0 then raise exception 'T56 % sees an insurer-logged claim', t; end if;
    select count(*) into n from public.my_notifications where claim_id = cid2; if n <> 0 then raise exception 'T56b % sees its notification', t; end if;
    reset role; checks := checks + 2;
  end loop;
  checks := checks + 1;

  ---- withdrawing a report the fleet should not send
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  cid3 := public.report_claim(f1, vother, null, D, null, now() - interval '5 hours', 'Depot yard', 'Scratch on the bumper in the yard, no other party.', false, null, false, null, true, false);
  begin perform public.withdraw_claim(cid3, ''); raise exception 'T57 withdrawn without a reason'; exception when sqlstate '22023' then null; end;
  perform public.withdraw_claim(cid3, 'Duplicate of an earlier report.');
  select count(*) into n from public.claims where id = cid3 and status = 'closed' and outcome = 'withdrawn'; if n <> 1 then raise exception 'T58 not withdrawn'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims where id = cid3; if n <> 0 then raise exception 'T59 insurer sees withdrawn unsent report'; end if;
  begin perform public.reopen_claim(cid3, 'give it back'); raise exception 'T60 reopened unsent'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 4;

  ---- the audit trail records what happened
  select count(*) into n from public.audit_logs where entity_id = cid and action in ('claim.reported','claim.submitted','claim.assessed','claim.closed','claim.reopened','claim.info_requested','claim.info_provided');
  if n < 7 then raise exception 'T61 audit entries missing (%)', n; end if; checks := checks + 1;
  raise exception 'CLAIMS TESTS PASSED (% checks)', checks;
end $$;
