-- Telematics test. Runs inside one block that always ends by raising, so nothing is kept.
-- A passing run ends with: ERROR: TELEMATICS TESTS PASSED (n checks). Any other message is a failure.
-- Uses the same dev fixtures as supabase/tests/cue.sql.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; D uuid := '68939de2-3e13-4b66-9115-0b0a742ea1ed';
  I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; P uuid := '1c6288ab-66cf-4beb-b31f-8cc6498d0da4';
  R uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; X uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  f1 uuid := '20000000-0000-4000-8000-000000000001'; f2 uuid := '20000000-0000-4000-8000-000000000002'; i2 uuid := '10000000-0000-4000-8000-000000000003';
  vd uuid := '6da45364-78e4-4ebd-9ee4-4dd8f0ad66db';
  reg text; res jsonb; n int; t text; checks int := 0; d0 text := to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  rows jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (R, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r@x.test'),
    (X, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@x.test');
  insert into public.memberships (user_id, organisation_id, role, active) values (R, f2, 'fleet_admin', true), (X, i2, 'insurer_admin', true);
  select registration into reg from public.vehicles where id = vd;
  -- the dev data already assigns D to this van from 23 Oct; a second overlapping row for the same person must still count as one driver
  insert into public.vehicle_assignments (fleet_id, vehicle_id, user_id, assigned_from) values (f1, vd, D, current_date - 2);
  rows := jsonb_build_array(
    jsonb_build_object('type', 'trip', 'registration', lower(substr(reg,1,2) || ' ' || substr(reg,3)), 'at', d0, 'distance_miles', 120.5),
    jsonb_build_object('type', 'event', 'registration', reg, 'at', d0, 'kind', 'harsh_braking', 'severity', 2, 'location', 'A1 northbound'),
    jsonb_build_object('type', 'event', 'registration', reg, 'at', d0, 'kind', 'speeding', 'severity', 1, 'speed_mph', 52, 'limit_mph', 40),
    jsonb_build_object('type', 'event', 'registration', reg, 'at', d0, 'kind', 'crash_alert', 'severity', 3));

  ---- who may import
  foreach t in array array[D::text, R::text, X::text, I::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    begin perform public.import_telematics(f1, rows); raise exception 'T1 % imported', t; exception when sqlstate '42501' then null; end;
    reset role; checks := checks + 1;
  end loop;

  ---- the fleet admin imports
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  res := public.import_telematics(f1, rows);
  if (res ->> 'events')::int <> 3 or (res ->> 'trips')::int <> 1 or (res ->> 'crash_alerts')::int <> 1 then raise exception 'T2 counts %', res; end if; checks := checks + 1;
  -- importing the same file again adds nothing
  res := public.import_telematics(f1, rows);
  if (res ->> 'events')::int <> 0 or (res ->> 'trips')::int <> 0 or (res ->> 'duplicates')::int <> 4 then raise exception 'T3 duplicates %', res; end if; checks := checks + 1;
  -- a bad row rejects the whole batch and says which row
  begin perform public.import_telematics(f1, rows || jsonb_build_array(jsonb_build_object('type', 'event', 'registration', 'ZZ99ZZZ', 'at', d0, 'kind', 'speeding')));
    raise exception 'T4 unknown vehicle accepted'; exception when sqlstate '22023' then if sqlerrm not like 'row 5:%' then raise exception 'T4 message %', sqlerrm; end if; end; checks := checks + 1;
  begin perform public.import_telematics(f1, jsonb_build_array(jsonb_build_object('type', 'event', 'registration', reg, 'at', d0, 'kind', 'wheelie')));
    raise exception 'T5 bad kind accepted'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.import_telematics(f1, jsonb_build_array(jsonb_build_object('type', 'event', 'registration', reg, 'at', to_char(now() + interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'kind', 'speeding')));
    raise exception 'T6 future date accepted'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.import_telematics(f1, '[]'::jsonb); raise exception 'T7 empty accepted'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  begin perform public.import_telematics(f1, jsonb_build_array(jsonb_build_object('type', 'trip', 'registration', reg, 'at', d0, 'distance_miles', -4)));
    raise exception 'T8 negative distance accepted'; exception when sqlstate '22023' then null; end; checks := checks + 1;
  -- direct writes are refused
  begin insert into public.telematics_events (fleet_id, vehicle_id, occurred_at, kind) values (f1, vd, now(), 'speeding'); raise exception 'T9 direct insert'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  begin delete from public.telematics_events; raise exception 'T10 direct delete'; exception when sqlstate '42501' then null; end; checks := checks + 1;
  -- the fleet reads the driver-level record, and the driver was matched from the assignment
  select count(*) into n from public.telematics_events where driver_id = D; if n <> 3 then raise exception 'T11 driver matched on % events', n; end if; checks := checks + 1;
  reset role;

  ---- another fleet sees nothing of f1's, cannot import into it
  perform set_config('request.jwt.claims', json_build_object('sub', R, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.telematics_events; if n <> 0 then raise exception 'T12 other fleet reads % events', n; end if;
  select count(*) into n from public.telematics_trips; if n <> 0 then raise exception 'T13 other fleet reads % trips', n; end if;
  begin perform public.import_telematics(f1, rows); raise exception 'T14 cross-fleet import'; exception when sqlstate '42501' then null; end;
  begin perform * from public.telematics_vehicle_totals(f1); raise exception 'T15 cross-fleet totals'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 4;

  ---- the driver and the unrelated insurer cannot read the raw records
  foreach t in array array[D::text, X::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); set local role authenticated;
    select count(*) into n from public.telematics_events; if n <> 0 then raise exception 'T16 % reads events', t; end if;
    reset role; checks := checks + 1;
  end loop;

  ---- the insurer reads vehicle totals only, never the raw (driver-named) rows
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.telematics_events; if n <> 0 then raise exception 'T17 insurer reads raw events'; end if;
  select count(*) into n from public.telematics_vehicle_totals(f1);
  if n <> 1 then raise exception 'T18 insurer sees % vehicle rows', n; end if;
  if (select miles from public.telematics_vehicle_totals(f1)) <> 120.5 or (select crash_alerts from public.telematics_vehicle_totals(f1)) <> 1
     or (select weighted_points from public.telematics_vehicle_totals(f1)) <> 4 then raise exception 'T19 totals wrong'; end if;
  reset role; checks := checks + 3;
  perform set_config('request.jwt.claims', json_build_object('sub', X, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform * from public.telematics_vehicle_totals(f1); raise exception 'T20 unrelated insurer'; exception when sqlstate '42501' then null; end;
  reset role; checks := checks + 1;

  ---- platform admin reads; crash alert notified; audit written
  perform set_config('request.jwt.claims', json_build_object('sub', P, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.telematics_events where fleet_id = f1; if n <> 3 then raise exception 'T21 platform sees % events', n; end if;
  reset role; checks := checks + 1;
  select count(*) into n from public.notifications where kind = 'telematics_crash' and organisation_id = f1; if n <> 1 then raise exception 'T22 crash notifications %', n; end if;
  select count(*) into n from public.audit_logs where action = 'telematics.imported' and entity_id = f1; if n <> 2 then raise exception 'T23 import audit entries %', n; end if;
  checks := checks + 2;
  raise exception 'TELEMATICS TESTS PASSED (% checks)', checks;
end $$;
