-- Demo book for insurer demonstrations: a fictional insurer with six fictional fleets, rates, commission terms and two months of cover movements.
-- Safe to run more than once (it stops if the demo insurer already exists). Run in the Supabase SQL editor.
-- Add the logins that should see it to the list below (they must already exist). Nothing here uses a real company name.
do $$
declare
  seq int := 0; v_emails text[] := array['owen@dcfgroup.co.uk'];   -- add Adam's login email here, e.g. array['owen@dcfgroup.co.uk','adam@example.com']
  ins uuid; f uuid; pol uuid; u uuid; e text; i int; j int; reg text; veh uuid; per uuid; st timestamptz; en timestamptz;
  fl record; today date := (now() at time zone 'Europe/London')::date;
  makes text[] := array['Ford Transit 350','Mercedes-Benz Sprinter','Volkswagen Crafter','Vauxhall Movano','Renault Master','Iveco Daily','Peugeot Boxer','Ford Transit Custom'];
begin
  if exists (select 1 from public.organisations where kind = 'insurer' and lower(name) = 'northbridge mutual (demo)') then
    raise notice 'Demo insurer already exists; nothing changed.'; return;
  end if;
  insert into public.organisations (kind, name) values ('insurer', 'Northbridge Mutual (demo)') returning id into ins;
  insert into public.billing_rules (insurer_id, effective_from, start_day_charged, end_day_charged, timezone, rounding_dp, vat_rate, note)
    values (ins, date '2026-01-01', true, true, 'Europe/London', 2, 0.12, 'Demo rules: start and end day charged, IPT 12%');

  -- name, vehicles, daily rate, commission %, addition fee, removal fee, minimum days, additions this month, additions last month, removals last month, removals this month
  for fl in select * from (values
    ('Pennine Haulage Ltd',            48, 11.40, 15.0, 7.50, 7.50, 28, 3, 4, 2, 1),
    ('Brightwater Couriers',           32,  9.86, 12.5, 5.00, 5.00, 28, 2, 3, 1, 1),
    ('Calder Building Services',       22,  8.90, 17.5, 0.00, 0.00, 14, 1, 2, 1, 0),
    ('Fenwick Food Distribution',      36, 10.25, 12.5, 6.00, 3.00, 28, 3, 2, 2, 1),
    ('Lakeland Care Transport',        14,  8.20, 10.0, 0.00, 0.00,  0, 1, 1, 0, 0),
    ('Westgate Plant & Hire',          18, 10.75, 15.0, 5.00, 5.00, 28, 2, 2, 1, 1)
  ) as t(name, n, rate, comm, addfee, remfee, mindays, add_now, add_prev, rem_prev, rem_now) loop
    insert into public.organisations (kind, name, insurer_id) values ('fleet', fl.name, ins) returning id into f;
    insert into public.policies (insurer_id, fleet_id, policy_number, name, valid_from)
      values (ins, f, 'NB-' || lpad((1000 + abs(hashtext(fl.name)) % 9000)::text, 4, '0') || '-26', fl.name || ' motor fleet', date '2026-01-01') returning id into pol;
    insert into public.rate_cards (policy_id, fleet_id, effective_from, daily_rate, note) values (pol, f, date '2026-01-01', fl.rate, 'Demo rate');
    insert into public.policy_terms (policy_id, insurer_id, effective_from, commission_pct, addition_fee, removal_fee, minimum_cover_days, note)
      values (pol, ins, date '2026-01-01', fl.comm, fl.addfee, fl.remfee, fl.mindays, 'Demo terms');
    -- vehicles: base book from 1 Sept, then additions last month and this month; some removed
    for i in 1 .. fl.n + fl.add_now + fl.add_prev loop
      seq := seq + 1;
      reg := 'Z' || chr(81 + seq % 2) || (24 + seq % 3)::text || chr(65 + (seq / 676) % 26) || chr(65 + (seq / 26) % 26) || chr(65 + seq % 26);
      insert into public.vehicles (fleet_id, registration, make_model) values (f, reg, makes[1 + (i + length(fl.name)) % 8]) returning id into veh;
      if i <= fl.n then st := timestamptz '2026-09-01 08:00 Europe/London' - ((i % 20) || ' days')::interval;
      elsif i <= fl.n + fl.add_prev then st := (date_trunc('month', today) - interval '1 month')::date + (3 + (i % 20)) ;
      else st := (date_trunc('month', today))::date + least(extract(day from today)::int - 1, 1 + (i % 7)) ; end if;
      st := (st::date)::timestamp at time zone 'Europe/London' + interval '9 hours';
      en := null;
      if i > fl.n - fl.rem_prev - fl.rem_now and i <= fl.n then
        j := i - (fl.n - fl.rem_prev - fl.rem_now);
        if j <= fl.rem_prev then en := ((date_trunc('month', today) - interval '1 month')::date + 10 + j * 4)::timestamp at time zone 'Europe/London' + interval '17 hours';
        elsif extract(day from today) > 3 then en := ((date_trunc('month', today))::date + least(extract(day from today)::int - 2, 2 + j))::timestamp at time zone 'Europe/London' + interval '17 hours'; end if;
      end if;
      insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start, cover_end) values (veh, f, pol, st, en) returning id into per;
      insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, recorded_at, note) values (f, veh, per, 'cover_added', st, st, 'Demo data');
      if en is not null then
        insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, recorded_at, note) values (f, veh, per, 'cover_removed', en, en, 'Demo data');
      end if;
    end loop;
    -- one vehicle added and taken off again within days, to show the minimum cover period being billed
    if fl.mindays > 0 then
      seq := seq + 1;
      reg := 'Z' || chr(81 + seq % 2) || (24 + seq % 3)::text || chr(65 + (seq / 676) % 26) || chr(65 + (seq / 26) % 26) || chr(65 + seq % 26);
      insert into public.vehicles (fleet_id, registration, make_model) values (f, reg, 'Ford Transit Custom') returning id into veh;
      st := ((date_trunc('month', today) - interval '1 month')::date + 19)::timestamp at time zone 'Europe/London' + interval '9 hours';
      en := ((date_trunc('month', today) - interval '1 month')::date + 22)::timestamp at time zone 'Europe/London' + interval '17 hours';
      insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start, cover_end) values (veh, f, pol, st, en) returning id into per;
      insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, recorded_at, note) values (f, veh, per, 'cover_added', st, st, 'Demo data');
      insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, recorded_at, note) values (f, veh, per, 'cover_removed', en, en, 'Demo data');
    end if;
  end loop;

  foreach e in array v_emails loop
    select id into u from auth.users where lower(email) = lower(e);
    if u is null then raise notice 'No login found for %, skipped', e;
    else insert into public.memberships (user_id, organisation_id, role) values (u, ins, 'insurer_admin') on conflict do nothing; end if;
  end loop;
  raise notice 'Demo insurer created.';
end $$;
