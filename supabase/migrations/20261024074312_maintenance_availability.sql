-- Derive availability without overwriting the fleet's manually recorded status.
create view public.crm_vehicle_availability with (security_invoker=true) as
select v.id, v.fleet_id,
 case
  when p.operational_status in ('off_road','disposed') then p.operational_status
  when exists(select 1 from public.crm_tasks t where t.vehicle_id=v.id and t.fleet_id=v.fleet_id
    and t.category<>'task' and t.status not in ('completed','cancelled')) then 'maintenance'
  else p.operational_status
 end as operational_status
from public.vehicles v left join public.crm_vehicle_profiles p on p.vehicle_id=v.id and p.fleet_id=v.fleet_id
where v.fleet_id in (select private.accessible_orgs('crm.read'));
revoke all on public.crm_vehicle_availability from public,anon,authenticated;
grant select on public.crm_vehicle_availability to authenticated;
