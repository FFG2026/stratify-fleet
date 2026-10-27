-- Third-party administrators: routing, recommendation only, and isolation from the fleet and other TPAs.
-- Runs in one block that always ends by raising. A passing run ends with: ERROR: TPA TESTS PASSED (n checks).
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  A uuid := 'bbbbbbbb-0000-4000-8000-000000000001'; C uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  T uuid := 'bbbbbbbb-0000-4000-8000-000000000003'; U uuid := 'bbbbbbbb-0000-4000-8000-000000000004';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; vd uuid := '6da45364-78e4-4ebd-9ee4-4dd8f0ad66db';
  ins uuid; cid uuid; t1 uuid; t2 uuid; n int; checks int := 0; res text;
begin
  select insurer_id into ins from public.organisations where id = f1;
  insert into auth.users (id, instance_id, aud, role, email) values
    (A, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpa-admin@x.test'),
    (C, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpa-claims@x.test'),
    (T, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpa-one@x.test'),
    (U, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpa-two@x.test');
  insert into public.memberships (user_id, organisation_id, role, active) values (A, ins, 'insurer_admin', true), (C, ins, 'insurer_claims', true);

  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true); set local role authenticated;
  cid := public.report_claim(null, vd, null, null, null, now() - interval '2 days', 'M62 near Leeds', 'Reversed into a bollard.', false, null, false, null, true, false);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.assess_claim(cid, 'ok', true); perform public.submit_claim(cid);
  begin perform public.create_tpa(ins, 'Fleet TPA'); raise exception 'T1 fleet created a TPA'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 1;

  -- claims staff cannot manage TPAs; the administrator can
  perform set_config('request.jwt.claims', json_build_object('sub', C, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.create_tpa(ins, 'Claims TPA'); raise exception 'T2 claims staff created a TPA'; exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true); set local role authenticated;
  t1 := public.create_tpa(ins, 'Alpha Claims'); t2 := public.create_tpa(ins, 'Beta Claims');
  res := public.add_tpa_member(t1, 'tpa-one@x.test'); if res <> 'added' then raise exception 'T3 add member gave %', res; end if;
  res := public.add_tpa_member(t2, 'tpa-two@x.test'); if res <> 'added' then raise exception 'T4 add member gave %', res; end if;
  res := public.add_tpa_member(t1, 'nobody@x.test'); if res <> 'no_login' then raise exception 'T5 expected no_login, got %', res; end if;
  begin perform public.add_tpa_member(t1, 'tpa-claims@x.test'); raise exception 'T6 insurer staff added as TPA'; exception when sqlstate '22023' or sqlstate '42501' then null; end;
  reset role; checks := checks + 6;

  -- before routing, a TPA sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', T, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims; if n <> 0 then raise exception 'T7 TPA saw % unrouted claims', n; end if;
  begin perform public.tpa_recommend(cid, 'settle', 'Looks fine'); raise exception 'T8 recommended on an unrouted claim'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 2;

  -- the insurer routes it
  perform set_config('request.jwt.claims', json_build_object('sub', C, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.assign_claim_tpa(cid, t1);
  perform public.insurer_tpa_note(cid, 'Please review the photos.');
  reset role; checks := checks + 1;

  -- the routed TPA sees the claim and can recommend, but not the other TPA
  perform set_config('request.jwt.claims', json_build_object('sub', T, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims where id = cid; if n <> 1 then raise exception 'T9 routed TPA saw % claims', n; end if;
  select count(*) into n from public.claim_tpa_notes where claim_id = cid; if n <> 1 then raise exception 'T10 TPA saw % notes', n; end if;
  select count(*) into n from public.claim_events where claim_id = cid and visibility <> 'shared'; if n <> 0 then raise exception 'T11 TPA saw % private events', n; end if;
  perform public.tpa_add_note(cid, 'Photos are clear.');
  begin perform public.tpa_recommend(cid, 'maybe', 'x'); raise exception 'T12 odd recommendation accepted'; exception when sqlstate '22023' then null; end;
  perform public.tpa_recommend(cid, 'settle', 'Damage matches the description.');
  begin perform public.assign_claim_tpa(cid, t2); raise exception 'T13 TPA re-routed a claim'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 6;

  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims; if n <> 0 then raise exception 'T14 other TPA saw % claims', n; end if;
  select count(*) into n from public.claim_tpa; if n <> 0 then raise exception 'T15 other TPA saw routing'; end if;
  begin perform public.tpa_add_note(cid, 'Let me in'); raise exception 'T16 other TPA wrote a note'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 3;

  -- the fleet and the driver never see any of it
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_tpa; if n <> 0 then raise exception 'T17 fleet saw routing'; end if;
  select count(*) into n from public.claim_tpa_notes; if n <> 0 then raise exception 'T18 fleet saw TPA notes'; end if;
  select count(*) into n from public.claim_events where claim_id = cid and kind = 'tpa_assigned'; if n <> 0 then raise exception 'T19 fleet saw routing event'; end if;
  select count(*) into n from public.audit_logs where action like 'claim.tpa%'; if n <> 0 then raise exception 'T20 fleet saw TPA audit rows'; end if;
  begin perform public.tpa_add_note(cid, 'hi'); raise exception 'T21 fleet wrote as a TPA'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 5;

  -- a TPA contacts the fleet on the insurer's behalf; the fleet sees it as the insurer
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.tpa_note_to_fleet(cid, 'Not mine'); raise exception 'T24 other TPA contacted the fleet'; exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', T, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.tpa_note_to_fleet(cid, 'Please send the repair estimate.');
  perform public.tpa_request_claim_items(cid, '[{"kind":"estimate"}]'::jsonb, 'Thanks', null);
  reset role; checks := checks + 3;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claim_events where claim_id = cid and kind = 'note' and side = 'insurer' and visibility = 'shared';
  if n <> 1 then raise exception 'T25 fleet saw % TPA notes', n; end if;
  select count(*) into n from public.claim_requests where claim_id = cid and answered_at is null; if n <> 1 then raise exception 'T26 fleet saw % requests', n; end if;
  reset role; checks := checks + 2;

  -- switching the TPA off removes its access
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_tpa_active(t1, false);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', T, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.claims; if n <> 0 then raise exception 'T22 switched-off TPA saw % claims', n; end if;
  reset role; checks := checks + 1;

  -- the insurer takes the claim back; the recommendation stays on record for the insurer
  perform set_config('request.jwt.claims', json_build_object('sub', C, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.assign_claim_tpa(cid, null);
  select count(*) into n from public.claim_tpa where claim_id = cid; if n <> 0 then raise exception 'T23 routing remained'; end if;
  reset role; checks := checks + 1;

  raise exception 'TPA TESTS PASSED (% checks)', checks;
end $$;
