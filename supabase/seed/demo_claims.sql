-- Demo claims with costs for the demo insurer, so burn rate shows real figures. Run once, after the burn-rate migration.
-- Needs the demo insurer and at least one of the logins you added to it (it uses the first as the reporter).
do $$
declare v_ins uuid; u uuid; c record; v_claim uuid; v record; n int := 0;
begin
  select o.id into v_ins from public.organisations o where o.kind = 'insurer' and lower(o.name) = 'northbridge mutual (demo)';
  if v_ins is null then raise exception 'Demo insurer not found'; end if;
  if exists (select 1 from public.claims where insurer_id = v_ins) then raise notice 'Demo claims already exist.'; return; end if;
  select m.user_id into u from public.memberships m where m.organisation_id = v_ins and m.active limit 1;
  if u is null then raise exception 'No login is attached to the demo insurer'; end if;

  for c in select * from (values
    ('Pennine Haulage Ltd',            'Rear-end collision on the A1(M) slip road', 21, 'under_review', 22000.00, 12000.00,  false),
    ('Pennine Haulage Ltd',            'Mirror and wing damage in depot yard',      45, 'closed',        1850.00,    0.00,   false),
    ('Pennine Haulage Ltd',            'Windscreen replacement',                    12, 'closed',         420.00,    0.00,   false),
    ('Brightwater Couriers',           'Parking scrape, rear bumper',               30, 'closed',         780.00,    0.00,   false),
    ('Brightwater Couriers',           'Side impact at junction, third party',      9,  'under_review',  3100.00, 4400.00,   true),
    ('Calder Building Services',       'Van stolen from site overnight',            38, 'under_review', 11000.00, 6000.00,   false),
    ('Fenwick Food Distribution',      'Reversing collision at supermarket bay',    27, 'closed',        2650.00,    0.00,   false),
    ('Fenwick Food Distribution',      'Cargo area water damage',                   16, 'under_review',  9800.00, 3200.00,   false),
    ('Fenwick Food Distribution',      'Low-speed collision with bollard',          6,  'under_review',     0.00, 2400.00,   false),
    ('Lakeland Care Transport',        'Door damage, car park',                     33, 'closed',         640.00,    0.00,   false),
    ('Westgate Plant & Hire',          'Hit-and-run while parked',                  19, 'under_review',  6900.00, 4100.00,   false),
    ('Westgate Plant & Hire',          'Tyre and wheel damage on site',             8,  'closed',        1250.00,    0.00,   false)
  ) as t(fleet, descr, days_ago, st, paid, reserve, injured) loop
    select cp.vehicle_id, vv.registration, o.id as fleet_id, cp.policy_id into v
      from public.organisations o join public.coverage_periods cp on cp.fleet_id = o.id join public.vehicles vv on vv.id = cp.vehicle_id
     where o.kind = 'fleet' and o.insurer_id = v_ins and o.name = c.fleet and cp.cover_end is null order by vv.registration offset n limit 1;
    n := n + 1;
    insert into public.claims (reference, fleet_id, insurer_id, policy_id, vehicle_id, registration, origin, reported_by, status, incident_at, location, description,
                               anyone_injured, submitted_at, closed_at, outcome)
    values (private.next_claim_ref(), v.fleet_id, v_ins, v.policy_id, v.vehicle_id, v.registration, 'fleet', u, c.st, now() - (c.days_ago || ' days')::interval, 'Demo location',
            c.descr || ' (demonstration claim)', c.injured, now() - ((c.days_ago - 1) || ' days')::interval,
            case when c.st = 'closed' then now() - ((c.days_ago - 2) || ' days')::interval end, case when c.st = 'closed' then 'settled' end)
    returning claims.id into v_claim;
    insert into public.claim_costs (claim_id, fleet_id, insurer_id, paid, reserve, note, recorded_by) values (v_claim, v.fleet_id, v_ins, c.paid, c.reserve, 'Demonstration figures', u);
  end loop;
  raise notice 'Demo claims created.';
end $$;
