-- Reminders, saved replies, possible duplicates and the digest. Runs in one block that always ends by raising.
-- A passing run ends with: ERROR: INSURER TOOLS TESTS PASSED (n checks). Any other message is a failure.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45';
  R uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002';
  vd uuid := '6da45364-78e4-4ebd-9ee4-4dd8f0ad66db';
  ins uuid; cid uuid; cid2 uuid; rid uuid; n int; checks int := 0; path text; sr uuid;
begin
  select insurer_id into ins from public.organisations where id = f1;
  insert into auth.users (id, instance_id, aud, role, email) values (R, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r@x.test');
  insert into public.memberships (user_id, organisation_id, role, active) values (R, f2, 'fleet_admin', true);

  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  cid := public.report_claim(null, vd, null, null, null, now() - interval '2 days', 'A1 near Leeds', 'Reversed into the van.', false, null, false, null, true, false);
  cid2 := public.report_claim(null, vd, null, null, null, now() - interval '1 day', 'A1 near Leeds', 'Reversed into the van again.', false, null, false, null, true, false);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.assess_claim(cid, 'ok', true); perform public.submit_claim(cid);
  perform public.assess_claim(cid2, 'ok', true); perform public.submit_claim(cid2);
  begin perform public.remind_fleet(cid, gen_random_uuid()); raise exception 'T1 fleet reminded'; exception when sqlstate '42501' then null; end;
  begin perform public.claim_possible_duplicates(cid); raise exception 'T2 fleet read duplicates'; exception when sqlstate '42501' then null; end;
  begin perform public.save_reply(ins, 'Hello', 'Hello there'); raise exception 'T3 fleet saved a reply'; exception when sqlstate '42501' then null; end;
  begin perform public.run_overdue_reminders(); raise exception 'T4 fleet ran reminders'; exception when sqlstate '42501' then null; end;
  begin perform public.insurer_digest(); raise exception 'T5 fleet read digest'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 5;

  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  rid := public.request_claim_info(cid, 'Please send the estimate.', current_date - 1);
  perform public.remind_fleet(cid, rid);
  begin perform public.remind_fleet(cid, rid); raise exception 'T6 reminded twice in a day'; exception when sqlstate '22023' then null; end;
  select count(*) into n from public.claim_possible_duplicates(cid);
  if n <> 1 then raise exception 'T7 expected 1 duplicate, got %', n; end if;
  sr := public.save_reply(ins, 'Estimate', 'Please send the repair estimate.');
  begin perform public.save_reply(ins, 'x', 'Please send it'); raise exception 'T8 short title'; exception when sqlstate '22023' then null; end;
  select count(*) into n from public.saved_replies; if n <> 1 then raise exception 'T9 insurer saw % replies', n; end if;
  reset role; checks := checks + 4;

  select count(*) into n from public.claim_events where claim_id = cid and kind = 'reminder';
  if n <> 1 then raise exception 'T10 reminder event count %', n; end if;
  update public.claim_requests set last_reminded_at = now() - interval '4 days', reminder_count = 1 where id = rid;
  checks := checks + 1;
  set local role service_role;
  select count(*) into n from public.run_overdue_reminders(); if n <> 1 then raise exception 'T11 overdue run reminded %', n; end if;
  select count(*) into n from public.run_overdue_reminders(); if n <> 0 then raise exception 'T12 overdue run repeated %', n; end if;
  select count(*) into n from public.insurer_digest(); if n < 1 then raise exception 'T13 digest empty'; end if;
  reset role; checks := checks + 3;

  -- Another insurer's side cannot read the saved reply
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.saved_replies; if n <> 0 then raise exception 'T14 other org saw replies'; end if;
  begin perform public.delete_saved_reply(sr); raise exception 'T15 other org deleted a reply'; exception when sqlstate '42501' then null; end;
  begin insert into public.saved_replies (insurer_id, title, body, created_by) values (ins, 'ab', 'cd', R); raise exception 'T16 direct insert'; exception when insufficient_privilege then null; end;
  reset role; checks := checks + 3;

  raise exception 'INSURER TOOLS TESTS PASSED (% checks)', checks;
end $$;
