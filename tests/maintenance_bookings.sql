-- Real RLS, lifecycle, completion and invoice checks. Test records are rolled back.
begin;
select set_config('booking.user',gen_random_uuid()::text,true),set_config('booking.other',gen_random_uuid()::text,true),set_config('booking.reader',gen_random_uuid()::text,true),set_config('booking.driver',gen_random_uuid()::text,true),set_config('booking.insurer',gen_random_uuid()::text,true),set_config('booking.vehicle',gen_random_uuid()::text,true),set_config('booking.vehicle2',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('booking.user')::uuid,'booking-test@example.invalid'),(current_setting('booking.other')::uuid,'booking-other@example.invalid'),(current_setting('booking.reader')::uuid,'booking-reader@example.invalid'),(current_setting('booking.driver')::uuid,'booking-driver@example.invalid'),(current_setting('booking.insurer')::uuid,'booking-insurer@example.invalid');
insert into public.memberships(user_id,organisation_id,role) values
 (current_setting('booking.user')::uuid,'20000000-0000-4000-8000-000000000001','fleet_manager'),
 (current_setting('booking.other')::uuid,'20000000-0000-4000-8000-000000000003','fleet_manager'),
 (current_setting('booking.reader')::uuid,'20000000-0000-4000-8000-000000000001','fleet_accounts'),
 (current_setting('booking.driver')::uuid,'20000000-0000-4000-8000-000000000001','driver'),
 (current_setting('booking.insurer')::uuid,'10000000-0000-4000-8000-000000000002','insurer_admin');
insert into public.vehicles(id,fleet_id,registration,make_model,created_by) values
 (current_setting('booking.vehicle')::uuid,'20000000-0000-4000-8000-000000000001','ZZ98TST','Booking test',current_setting('booking.user')::uuid),
 (current_setting('booking.vehicle2')::uuid,'20000000-0000-4000-8000-000000000001','ZZ97TST','Booking test 2',current_setting('booking.user')::uuid);
select set_config('request.jwt.claim.sub',current_setting('booking.user'),true);
set local role authenticated;
do $$ declare f uuid:='20000000-0000-4000-8000-000000000001';v uuid:=current_setting('booking.vehicle')::uuid;v2 uuid:=current_setting('booking.vehicle2')::uuid;g uuid;t uuid;t2 uuid;before_cover bigint;payload jsonb;begin
 select count(*) into before_cover from public.coverage_periods;
 insert into public.crm_contacts(fleet_id,name,kind) values(f,'Booking test garage','garage') returning id into g;
 insert into public.crm_vehicle_profiles(fleet_id,vehicle_id,mileage,mileage_recorded_on,operational_status) values(f,v,100,current_date,'available');
 insert into public.crm_tasks(fleet_id,vehicle_id,title,category,booking_stage,appointment_on,expected_return_on,supplier_id,estimated_cost)
 values(f,v,'Scheduled service','service','booked',current_date+7,current_date+8,g,250) returning id into t;
 perform set_config('booking.task',t::text,true);
 if (select operational_status from public.crm_vehicle_availability where id=v) is distinct from 'available' then raise exception 'Future booking unavailable';end if;
 update public.crm_tasks set taken_off_road=true where id=t;
 if (select operational_status from public.crm_vehicle_availability where id=v) is distinct from 'maintenance' then raise exception 'Explicit off road ignored';end if;
 update public.crm_tasks set taken_off_road=false where id=t;
 begin update public.crm_tasks set booking_stage='completed',completion_mileage=200,cost=225 where id=t;raise exception 'Skipped collection stages';exception when invalid_parameter_value then null;end;
 select to_jsonb(x) into payload from public.crm_tasks x where id=t;
 begin perform public.crm_update_booking(t,now()-interval '1 minute',payload);raise exception 'Stale form accepted';exception when serialization_failure then null;end;
 perform public.crm_update_booking(t,(select updated_at from public.crm_tasks where id=t),payload||'{"booking_stage":"checked_in"}'::jsonb);
 if (select operational_status from public.crm_vehicle_availability where id=v) is distinct from 'maintenance' then raise exception 'Checked-in vehicle available';end if;
 update public.crm_tasks set booking_stage='work_underway',approval_required=true where id=t;
 if (select status from public.crm_tasks where id=t)<>'awaiting_approval' then raise exception 'Approval flag ignored';end if;
 update public.crm_tasks set booking_stage='ready_to_collect' where id=t;
 begin update public.crm_tasks set booking_stage='completed',completion_mileage=200,cost=225 where id=t;raise exception 'Unresolved approval accepted';exception when invalid_parameter_value then null;end;
 update public.crm_tasks set approval_required=false where id=t;
 begin update public.crm_tasks set booking_stage='completed',completion_mileage=99,cost=225 where id=t;raise exception 'Mileage rollback allowed';exception when invalid_parameter_value then null;end;
 if (select booking_stage from public.crm_tasks where id=t)<>'ready_to_collect' then raise exception 'Failed completion partially saved';end if;
 update public.crm_tasks set booking_stage='completed',completion_mileage=200,cost=225,next_service_on=current_date+365,next_service_mileage=12000 where id=t;
 if (select operational_status from public.crm_vehicle_availability where id=v) is distinct from 'available' then raise exception 'Collection did not restore availability';end if;
 if not exists(select 1 from public.crm_vehicle_profiles where vehicle_id=v and mileage=200 and service_due=current_date+365 and service_due_mileage=12000) then raise exception 'Completion profile update missing';end if;
 begin update public.crm_tasks set detail='Rewrite closed job' where id=t;raise exception 'Closed booking editable';exception when invalid_parameter_value then null;end;
 insert into public.crm_documents(fleet_id,vehicle_id,task_id,title,storage_path,file_name,content_type,size_bytes) values(f,v,t,'Invoice',f::text||'/'||gen_random_uuid()||'.pdf','invoice.pdf','application/pdf',100);
 begin insert into public.crm_documents(fleet_id,vehicle_id,task_id,title,storage_path,file_name,content_type,size_bytes) values(f,v2,t,'Wrong vehicle',f::text||'/'||gen_random_uuid()||'.pdf','bad.pdf','application/pdf',100);raise exception 'Invoice linked to wrong vehicle';exception when foreign_key_violation then null;end;
 insert into public.crm_tasks(fleet_id,vehicle_id,title,category,booking_stage,appointment_on,expected_return_on,supplier_id) values(f,v2,'No profile','repair','checked_in',current_date,current_date,g) returning id into t2;
 update public.crm_tasks set booking_stage='cancelled' where id=t2;
 if (select operational_status from public.crm_vehicle_availability where id=v2) is not null then raise exception 'Missing profile should remain unknown';end if;
 if (select count(*) from public.coverage_periods)<>before_cover then raise exception 'Maintenance changed insurance';end if;
 if not exists(select 1 from public.crm_events where entity_id=t and after_state->>'booking_stage'='completed') then raise exception 'Booking audit missing';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('booking.other'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.crm_tasks where id=current_setting('booking.task')::uuid) then raise exception 'Other fleet sees booking';end if;
 begin perform public.crm_update_booking(current_setting('booking.task')::uuid,now(),'{}');raise exception 'Other fleet edits booking';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('booking.reader'),true);
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.crm_tasks where id=current_setting('booking.task')::uuid) then raise exception 'Accounts cannot read booking';end if;
 begin perform public.crm_update_booking(current_setting('booking.task')::uuid,now(),'{}');raise exception 'Read-only account edits booking';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('booking.driver'),true);
set local role authenticated;
do $$ begin if exists(select 1 from public.crm_vehicle_availability) then raise exception 'Driver sees CRM status';end if;end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('booking.insurer'),true);
set local role authenticated;
do $$ begin if exists(select 1 from public.crm_tasks where id=current_setting('booking.task')::uuid) then raise exception 'Insurer sees fleet booking';end if;end $$;
reset role;
rollback;
select 'PASS: booking lifecycle, availability, collection, invoice isolation, permissions, audit and insurance unchanged; rolled back.' as result;
