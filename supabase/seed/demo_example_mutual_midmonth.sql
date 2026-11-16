-- Demo data for "Example Mutual Insurance (FICTIONAL)": vehicles that come off cover (or go on) part way through the current month,
-- so the vehicle register, bordereau and reconciliation show part-month vehicles. Fictional data only.
-- Safe to run more than once (stops if the demo vehicles already exist). Only touches DEV-POL-0001 and DEV-POL-0002 and never the
-- hand-entered test vehicles; removals use existing "Example Van" vehicles, additions are new fictional vehicles (XA26NV..).
do $$
declare
  ms date := date_trunc('month', now() at time zone 'Europe/London')::date;
  pol1 uuid := '30000000-0000-4000-8000-000000000001'; pol2 uuid := '30000000-0000-4000-8000-000000000002';
  r record; a record; v uuid; per uuid; fl uuid; st timestamptz; en timestamptz; rec timestamptz; removed int := 0; added int := 0;
begin
  if exists (select 1 from public.vehicles where registration like 'XA26NV%') then raise notice 'Mid-month demo data already exists; nothing changed.'; return; end if;

  -- 1. Existing vehicles taken off cover part way through the month (day of month, 17:00 London). Later days are scheduled removals.
  for r in
    with picks as (
      select cp.id, cp.vehicle_id, cp.fleet_id, cp.policy_id, vh.registration,
             row_number() over (partition by cp.policy_id order by md5(vh.registration)) rn
        from public.coverage_periods cp join public.vehicles vh on vh.id = cp.vehicle_id
       where cp.policy_id in (pol1, pol2) and cp.voided_at is null and cp.cover_end is null
         and cp.cover_start < (ms::timestamp at time zone 'Europe/London')
         and (cp.policy_id = pol2 or vh.make_model like 'Example Van%'))
    select p.*, d.dom from picks p join (values
      (pol1,1,3),(pol1,2,3),(pol1,3,5),(pol1,4,6),(pol1,5,9),(pol1,6,10),(pol1,7,10),(pol1,8,12),(pol1,9,13),(pol1,10,13),(pol1,11,14),
      (pol1,12,18),(pol1,13,20),(pol1,14,24),(pol1,15,27),
      (pol2,1,7),(pol2,2,14),(pol2,3,25)) d(policy_id, rn, dom) on d.policy_id = p.policy_id and d.rn = p.rn
  loop
    en := (ms + (r.dom - 1))::timestamp at time zone 'Europe/London' + interval '17 hours';
    rec := case when en <= now() then en else now() - interval '1 day' end;   -- scheduled removals were recorded yesterday
    update public.coverage_periods set cover_end = en, closed_at = rec where id = r.id;
    insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, recorded_at, note, details)
      values (r.fleet_id, r.vehicle_id, r.id, 'cover_removed', en, rec, 'Demo data', jsonb_build_object('registration', r.registration, 'policy_id', r.policy_id));
    removed := removed + 1;
  end loop;

  -- 2. New fictional vehicles added part way through the month; one is also removed again before the month ends.
  for a in select * from (values
      (pol1,'NVA',2,null::int),(pol1,'NVB',5,null),(pol1,'NVC',9,null),(pol1,'NVD',11,null),(pol1,'NVE',4,12),(pol2,'NVF',10,null)
    ) t(policy_id, suffix, start_dom, end_dom) loop
    select fleet_id into fl from public.policies where id = a.policy_id;
    insert into public.vehicles (fleet_id, registration, make_model, created_at)
      values (fl, 'XA26' || a.suffix, 'Example Van 7' || (ascii(right(a.suffix, 1)) - 64)::text || '0 (DEMO)', now()) returning id into v;
    st := (ms + (a.start_dom - 1))::timestamp at time zone 'Europe/London' + interval '9 hours';
    en := case when a.end_dom is null then null else (ms + (a.end_dom - 1))::timestamp at time zone 'Europe/London' + interval '17 hours' end;
    insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start, cover_end, created_at, closed_at)
      values (v, fl, a.policy_id, st, en, st, en) returning id into per;
    insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, recorded_at, note, details)
      values (fl, v, per, 'cover_added', st, st, 'Demo data', jsonb_build_object('registration', 'XA26' || a.suffix, 'policy_id', a.policy_id));
    if en is not null then
      insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, recorded_at, note, details)
        values (fl, v, per, 'cover_removed', en, en, 'Demo data', jsonb_build_object('registration', 'XA26' || a.suffix, 'policy_id', a.policy_id));
    end if;
    added := added + 1;
  end loop;
  raise notice 'Mid-month demo data created: % removals, % additions.', removed, added;
end $$;
