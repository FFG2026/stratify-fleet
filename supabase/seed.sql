-- Fictional data only. Optional: run on a NEW empty development database.
-- Refuses populated projects; never replaces existing data.
do $$
declare
 platform_id uuid; insurer_id uuid; other_insurer uuid; fleet_id uuid; policy_id uuid; vehicle_id uuid;
 k integer; i integer; total integer; reg text; ms date := date_trunc('month',current_date)::date;
begin
 if exists(select 1 from public.organisations) then raise exception 'Seed requires an empty development database'; end if;
 insert into public.organisations(kind,name) values('platform','Stratify Platform (DEV)') returning id into platform_id;
 insert into public.organisations(kind,name) values('insurer','Example Mutual Insurance (FICTIONAL)') returning id into insurer_id;
 insert into public.organisations(kind,name) values('insurer','Sample Underwriters (FICTIONAL)') returning id into other_insurer;
 for k in 1..3 loop
  insert into public.organisations(kind,name,insurer_id)
  values('fleet',case k when 1 then 'Northbank Logistics (FICTIONAL)' when 2 then 'Riverside Couriers (FICTIONAL)' else 'Hilltop Vans (FICTIONAL)' end,case when k=3 then other_insurer else insurer_id end) returning id into fleet_id;
  insert into public.policies(insurer_id,fleet_id,policy_number,name,valid_from,valid_to)
  values(case when k=3 then other_insurer else insurer_id end,fleet_id,'DEMO-'||k,'Fictional development policy',ms,(ms+interval '1 year')::date) returning id into policy_id;
  insert into public.rate_cards(policy_id,fleet_id,effective_from,daily_rate,note)
  values(policy_id,fleet_id,ms,3.25,'Fictional development rate; not agreed insurer terms');
  total:=case k when 1 then 600 when 2 then 20 else 10 end;
  for i in 1..total loop
   reg:='ZZ26'||chr(65+(i/676)%26)||chr(65+(i/26)%26)||chr(65+i%26);
   insert into public.vehicles(fleet_id,registration,make_model) values(fleet_id,reg,'Ford Transit (DEMO)') returning id into vehicle_id;
   insert into public.coverage_periods(vehicle_id,fleet_id,policy_id,cover_start)
   values(vehicle_id,fleet_id,policy_id,ms::timestamp at time zone 'Europe/London');
  end loop;
 end loop;
end $$;
