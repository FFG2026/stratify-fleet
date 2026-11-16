-- Demo drivers and vehicle assignments for Northbank Logistics (FICTIONAL), so the vehicle page shows a current driver and a driver history.
-- Fictional people only. The logins created here cannot sign in (no password, banned, address on a reserved .invalid domain).
-- Safe to run more than once (stops if the demo drivers already exist). Run after demo_example_mutual_midmonth.sql.
do $$
declare
  pol uuid := '30000000-0000-4000-8000-000000000001'; fl uuid; d record; u uuid; ids jsonb := '{}'::jsonb; a record; veh uuid;
  vans uuid[]; ms date := date_trunc('month', now() at time zone 'Europe/London')::date;
begin
  select fleet_id into fl from public.policies where id = pol;
  if exists (select 1 from auth.users where email like 'demo.driver.%@demo.stratifyfleet.invalid') then raise notice 'Demo drivers already exist; nothing changed.'; return; end if;

  for d in select * from (values
    (1,'James Carter','CARTE901015J99AB','07700 900101'),(2,'Sophie Khan','KHAN9805204S99CD','07700 900102'),
    (3,'Michael Parkin','PARKI851112M99EF','07700 900103'),(4,'Aimee Walsh','WALSH920730A99GH','07700 900104'),
    (5,'Daniel Brooks','BROOK880415D99IJ','07700 900105'),(6,'Chris Turner','TURNE790923C99KL','07700 900106'),
    (7,'Leah Simmons','SIMMO950312L99MN','07700 900107'),(8,'Ryan Edwards','EDWAR870604R99OP','07700 900108'),
    (9,'Priya Shah','SHAH9001185P99QR','07700 900109'),(10,'Tom Hargreaves','HARGR830227T99ST','07700 900110')
  ) t(n, name, licence, phone) loop
    u := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change, banned_until)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo.driver.' || d.n || '@demo.stratifyfleet.invalid', now(),
              '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', d.name), now() - interval '9 months', now(), '', '', '', '', 'infinity');
    insert into public.profiles (id, full_name) values (u, d.name) on conflict (id) do nothing;
    insert into public.memberships (user_id, organisation_id, role) values (u, fl, 'driver');
    insert into public.driver_profiles (user_id, fleet_id, full_name, date_of_birth, licence_number, phone)
      values (u, fl, d.name, date '1975-01-01' + (d.n * 900), d.licence, d.phone);
    ids := ids || jsonb_build_object(d.n::text, u);
  end loop;

  -- the first five long-running demo vans in the register order (newest start first), leaving the fifth with no driver
  select array_agg(vehicle_id order by cover_start desc, id) into vans from (
    select cp.vehicle_id, cp.cover_start, cp.id from public.coverage_periods cp join public.vehicles v on v.id = cp.vehicle_id
     where cp.policy_id = pol and cp.voided_at is null and cp.cover_end is null and v.make_model like 'Example Van %' and v.registration not like 'XA26NV%'
     order by cp.cover_start desc, cp.id limit 5) s;

  for a in select * from (values
    -- van 1: three drivers over time, the latest current
    (1,7,date '2026-03-23',date '2026-06-30'),(1,8,date '2026-07-01',date '2026-09-14'),(1,1,date '2026-09-15',null::date),
    -- van 2: driver changed at the end of October
    (2,6,date '2026-03-23',date '2026-10-31'),(2,8,ms + 2,null),
    -- vans 3 and 4: one driver each since the start
    (3,9,date '2026-03-23',null),(4,10,date '2026-03-23',null)
  ) t(van, drv, af, ato) loop
    insert into public.vehicle_assignments (fleet_id, vehicle_id, user_id, assigned_from, assigned_to)
      values (fl, vans[a.van], (ids ->> a.drv::text)::uuid, a.af, a.ato);
  end loop;

  -- the vehicles added this month get their driver from the day they started; the one removed on the 12th had Chris Turner until then
  for a in select * from (values
    ('XA26NVA',2,ms + 1,null::date),('XA26NVB',3,ms + 4,null),('XA26NVC',4,ms + 8,null),('XA26NVD',5,ms + 10,null),('XA26NVE',6,ms + 3,ms + 11)
  ) t(reg, drv, af, ato) loop
    select id into veh from public.vehicles where fleet_id = fl and registration = a.reg;
    if veh is not null then
      insert into public.vehicle_assignments (fleet_id, vehicle_id, user_id, assigned_from, assigned_to)
        values (fl, veh, (ids ->> a.drv::text)::uuid, a.af, a.ato);
    end if;
  end loop;
  raise notice 'Demo drivers and assignments created.';
end $$;
