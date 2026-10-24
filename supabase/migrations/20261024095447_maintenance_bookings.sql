alter table public.crm_tasks
 add column booking_stage text check(booking_stage in ('booked','checked_in','work_underway','ready_to_collect','completed','cancelled')),
 add column appointment_on date,
 add column expected_return_on date,
 add column estimated_cost numeric(12,2) check(estimated_cost between 0 and 10000000),
 add column taken_off_road boolean not null default false,
 add column approval_required boolean not null default false,
 add column completion_mileage integer check(completion_mileage between 0 and 5000000),
 add column completed_on date,
 add column next_service_on date,
 add column next_service_mileage integer check(next_service_mileage between 0 and 5000000),
 add constraint crm_booking_vehicle_required check(booking_stage is null or (vehicle_id is not null and category<>'task')),
 add constraint crm_booking_dates check(booking_stage is null or (appointment_on is not null and expected_return_on is not null and expected_return_on>=appointment_on));
alter table public.crm_tasks add constraint crm_task_id_fleet_vehicle unique(id,fleet_id,vehicle_id);
alter table public.crm_documents add column task_id uuid,
 add constraint crm_document_task_vehicle foreign key(task_id,fleet_id,vehicle_id) references public.crm_tasks(id,fleet_id,vehicle_id),
 add constraint crm_invoice_vehicle_required check(task_id is null or vehicle_id is not null);
create index crm_documents_task on public.crm_documents(task_id);
create index crm_bookings_return on public.crm_tasks(fleet_id,expected_return_on) where booking_stage is not null and status not in ('completed','cancelled');

-- Invoker triggers retain the existing CRM RLS and audited writes.
create function private.crm_booking_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.booking_stage is not null then
  if new.booking_stage is null or new.vehicle_id is distinct from old.vehicle_id or new.category is distinct from old.category then
   raise exception 'A booking cannot be detached from its vehicle or maintenance category.' using errcode='22023';
  end if;
  if old.booking_stage in ('completed','cancelled') and new is distinct from old then
   raise exception 'This booking is closed. Create a new booking for further work.' using errcode='22023';
  end if;
  if new.booking_stage<>old.booking_stage and not (
    (old.booking_stage='booked' and new.booking_stage in ('checked_in','cancelled')) or
    (old.booking_stage='checked_in' and new.booking_stage in ('work_underway','cancelled')) or
    (old.booking_stage='work_underway' and new.booking_stage in ('ready_to_collect','cancelled')) or
    (old.booking_stage='ready_to_collect' and new.booking_stage in ('work_underway','completed','cancelled'))
  ) then raise exception 'Move the booking through check-in, work and collection in order.' using errcode='22023';end if;
 end if;
 if new.booking_stage is null then return new;end if;
 if auth.uid() is null or not private.has_permission(new.fleet_id,'crm.manage') then raise exception 'You cannot change this booking.' using errcode='42501';end if;
 if tg_op='INSERT' and new.booking_stage not in ('booked','checked_in') then raise exception 'Start with a booking or check-in.' using errcode='22023';end if;
 if tg_op='UPDATE' and old.booking_stage is null and new.booking_stage not in ('booked','checked_in') then raise exception 'Set up the booking before moving work forward.' using errcode='22023';end if;
 if new.supplier_id is null or not exists(select 1 from public.crm_contacts where id=new.supplier_id and fleet_id=new.fleet_id and active and kind='garage') then
  raise exception 'Choose an active garage contact in this fleet.' using errcode='22023';end if;
 if new.booking_stage='completed' then
  if new.completion_mileage is null or new.cost is null then raise exception 'Record collection mileage and the actual cost before completing.' using errcode='22023';end if;
  if new.approval_required then raise exception 'Resolve the approval flag before completing.' using errcode='22023';end if;
  new.completed_on:=(now() at time zone 'Europe/London')::date;
  if new.next_service_on is not null and new.next_service_on<=new.completed_on then raise exception 'Next service must be after collection.' using errcode='22023';end if;
  if new.next_service_mileage is not null and new.next_service_mileage<=new.completion_mileage then raise exception 'Next service mileage must exceed collection mileage.' using errcode='22023';end if;
 else
  new.completed_on:=null;
  if new.completion_mileage is not null or new.next_service_on is not null or new.next_service_mileage is not null then raise exception 'Record mileage and the next service when completing collection.' using errcode='22023';end if;
 end if;
 new.status:=case when new.booking_stage in ('completed','cancelled') then new.booking_stage when new.approval_required then 'awaiting_approval' when new.booking_stage='booked' then 'open' else 'in_progress' end;
 new.due_on:=new.appointment_on;
 return new;
end $$;
revoke all on function private.crm_booking_guard() from public,anon,authenticated;
create trigger booking_guard before insert or update on public.crm_tasks for each row execute function private.crm_booking_guard();

create function private.crm_booking_complete() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.booking_stage='completed' and old.booking_stage is distinct from 'completed' then
  -- Serialize completion readings without granting updates to insurance vehicle records.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.vehicle_id::text,0));
  if exists(select 1 from public.crm_vehicle_profiles where vehicle_id=new.vehicle_id and mileage>new.completion_mileage) then
   raise exception 'Collection mileage is below the latest vehicle reading.' using errcode='22023';end if;
  insert into public.crm_vehicle_profiles(fleet_id,vehicle_id,mileage,mileage_recorded_on,service_due,service_due_mileage)
  values(new.fleet_id,new.vehicle_id,new.completion_mileage,new.completed_on,new.next_service_on,new.next_service_mileage)
  on conflict(vehicle_id) do update set mileage=excluded.mileage,mileage_recorded_on=excluded.mileage_recorded_on,
   service_due=coalesce(excluded.service_due,crm_vehicle_profiles.service_due),
   service_due_mileage=coalesce(excluded.service_due_mileage,crm_vehicle_profiles.service_due_mileage)
   where crm_vehicle_profiles.mileage is null or crm_vehicle_profiles.mileage<=excluded.mileage;
  if not found then raise exception 'Collection mileage is below the latest vehicle reading.' using errcode='22023';end if;
 end if;return new;
end $$;
revoke all on function private.crm_booking_complete() from public,anon,authenticated;
create trigger booking_complete after update on public.crm_tasks for each row execute function private.crm_booking_complete();

-- Optimistic concurrency plus row lock: stale forms cannot overwrite a colleague's update.
create function public.crm_update_booking(p_id uuid,p_expected_updated_at timestamptz,p_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare t public.crm_tasks;
begin
 select * into t from public.crm_tasks where id=p_id for update;
 if not found or not private.has_permission(t.fleet_id,'crm.manage') then raise exception 'Booking not found or not editable.' using errcode='42501';end if;
 if t.updated_at is distinct from p_expected_updated_at then raise exception 'This job changed. Refresh the page before saving.' using errcode='40001';end if;
 if t.category='task' then raise exception 'Choose a maintenance job.' using errcode='22023';end if;
 update public.crm_tasks set booking_stage=p_data->>'booking_stage',supplier_id=(p_data->>'supplier_id')::uuid,
  appointment_on=(p_data->>'appointment_on')::date,expected_return_on=(p_data->>'expected_return_on')::date,
  estimated_cost=(p_data->>'estimated_cost')::numeric,cost=(p_data->>'cost')::numeric,
  taken_off_road=coalesce((p_data->>'taken_off_road')::boolean,false),approval_required=coalesce((p_data->>'approval_required')::boolean,false),
  completion_mileage=(p_data->>'completion_mileage')::integer,next_service_on=(p_data->>'next_service_on')::date,
  next_service_mileage=(p_data->>'next_service_mileage')::integer,detail=coalesce(p_data->>'detail','') where id=p_id;
end $$;
revoke all on function public.crm_update_booking(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.crm_update_booking(uuid,timestamptz,jsonb) to authenticated;

create or replace view public.crm_vehicle_availability with (security_invoker=true) as
select v.id,v.fleet_id,case
 when p.operational_status in ('off_road','disposed') then p.operational_status
 when exists(select 1 from public.crm_tasks t where t.vehicle_id=v.id and t.fleet_id=v.fleet_id and t.category<>'task' and t.status not in ('completed','cancelled')
  and (t.booking_stage is null or t.taken_off_road or t.booking_stage in ('checked_in','work_underway','ready_to_collect'))) then 'maintenance'
 else p.operational_status end as operational_status
from public.vehicles v left join public.crm_vehicle_profiles p on p.vehicle_id=v.id and p.fleet_id=v.fleet_id
where v.fleet_id in (select private.accessible_orgs('crm.read'));
