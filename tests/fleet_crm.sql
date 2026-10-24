-- Real database/RLS checks. Every identity, record and file row is rolled back.
begin;
select set_config('crm.a',gen_random_uuid()::text,true),set_config('crm.b',gen_random_uuid()::text,true),set_config('crm.insurer',gen_random_uuid()::text,true),set_config('crm.driver',gen_random_uuid()::text,true),set_config('crm.accounts',gen_random_uuid()::text,true);
insert into auth.users(id,email) values
 (current_setting('crm.a')::uuid,'crm-a@example.invalid'),(current_setting('crm.b')::uuid,'crm-b@example.invalid'),
 (current_setting('crm.insurer')::uuid,'crm-insurer@example.invalid'),(current_setting('crm.driver')::uuid,'crm-driver@example.invalid'),(current_setting('crm.accounts')::uuid,'crm-accounts@example.invalid');
insert into public.memberships(user_id,organisation_id,role) values
 (current_setting('crm.a')::uuid,'20000000-0000-4000-8000-000000000001','fleet_admin'),
 (current_setting('crm.b')::uuid,'20000000-0000-4000-8000-000000000003','fleet_admin'),
 (current_setting('crm.insurer')::uuid,'10000000-0000-4000-8000-000000000002','insurer_admin'),
 (current_setting('crm.driver')::uuid,'20000000-0000-4000-8000-000000000001','driver'),
 (current_setting('crm.accounts')::uuid,'20000000-0000-4000-8000-000000000001','fleet_accounts');
select set_config('crm.vehicle_a',(select id::text from public.vehicles where fleet_id='20000000-0000-4000-8000-000000000001' limit 1),true),set_config('crm.vehicle_b',(select id::text from public.vehicles where fleet_id='20000000-0000-4000-8000-000000000003' limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('crm.b'),true);
set local role authenticated;
insert into public.crm_contacts(fleet_id,name,kind) values('20000000-0000-4000-8000-000000000003','Other fleet garage','garage');
reset role;
select set_config('crm.contact_b',(select id::text from public.crm_contacts where name='Other fleet garage'),true);
select set_config('request.jwt.claim.sub',current_setting('crm.a'),true);
set local role authenticated;
do $$ declare profile_id uuid; contact_id uuid; task_id uuid; before_cover bigint; begin
 select count(*) into before_cover from public.coverage_periods;
 insert into public.crm_vehicle_profiles(fleet_id,vehicle_id,depot,operational_status,mileage,mileage_recorded_on)
 values('20000000-0000-4000-8000-000000000001',current_setting('crm.vehicle_a')::uuid,'Kent','off_road',50000,current_date) returning id into profile_id;
 insert into public.crm_contacts(fleet_id,name,kind) values('20000000-0000-4000-8000-000000000001','Own garage','garage') returning id into contact_id;
 insert into public.crm_tasks(fleet_id,vehicle_id,title,category,assignee_id,due_on,cost)
 values('20000000-0000-4000-8000-000000000001',current_setting('crm.vehicle_a')::uuid,'Repair test','repair',contact_id,current_date,240) returning id into task_id;
 update public.crm_tasks set status='completed',detail='Repaired' where id=task_id;
 if (select count(*) from public.coverage_periods)<>before_cover then raise exception 'CRM changed cover'; end if;
 if (select count(*) from public.crm_events where fleet_id='20000000-0000-4000-8000-000000000001')<>4 then raise exception 'Missing audit timeline'; end if;
 if not exists(select 1 from public.audit_logs where entity_id=task_id and action='crm.crm_tasks.update') then raise exception 'Missing immutable audit'; end if;
 if exists(select 1 from public.crm_contacts where name='Other fleet garage') then raise exception 'Cross-tenant read'; end if;
 begin
  insert into public.crm_tasks(fleet_id,title) values('20000000-0000-4000-8000-000000000003','Forbidden');raise exception 'Cross-tenant write allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.crm_tasks(fleet_id,vehicle_id,title) values('20000000-0000-4000-8000-000000000001',current_setting('crm.vehicle_b')::uuid,'Foreign vehicle');raise exception 'Foreign vehicle allowed';
 exception when foreign_key_violation then null; end;
 begin
  update public.crm_tasks set supplier_id=current_setting('crm.contact_b')::uuid where id=task_id;raise exception 'Foreign supplier allowed';
 exception when foreign_key_violation then null; end;
 begin
  update public.crm_tasks set fleet_id='20000000-0000-4000-8000-000000000003' where id=task_id;raise exception 'Fleet reassignment allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.crm_events(fleet_id,entity_id,entity_type,action,actor_id) values('20000000-0000-4000-8000-000000000001',task_id,'fake','fake',auth.uid());raise exception 'Forged audit allowed';
 exception when insufficient_privilege then null; end;
 if not private.crm_storage_permission('20000000-0000-4000-8000-000000000001/test.pdf','crm.manage') then raise exception 'Own file write denied'; end if;
 if private.crm_storage_permission('20000000-0000-4000-8000-000000000003/test.pdf','crm.read') then raise exception 'Foreign file read allowed'; end if;
 if private.crm_storage_permission('not-a-uuid/test.pdf','crm.read') then raise exception 'Malformed path allowed'; end if;
 begin delete from public.crm_tasks where id=task_id;raise exception 'Hard deletion allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('crm.insurer'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.crm_tasks)<>1 then raise exception 'Insurer scope incorrect';end if;
 begin insert into public.crm_tasks(fleet_id,title) values('20000000-0000-4000-8000-000000000001','Insurer write');raise exception 'Insurer write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('crm.accounts'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.crm_tasks)<>1 then raise exception 'Accounts read incorrect';end if;
 begin insert into public.crm_tasks(fleet_id,title) values('20000000-0000-4000-8000-000000000001','Accounts write');raise exception 'Accounts write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('crm.driver'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.crm_tasks) or exists(select 1 from public.crm_contacts) or exists(select 1 from public.crm_events) then raise exception 'Driver sees CRM';end if;
 if private.crm_storage_permission('20000000-0000-4000-8000-000000000001/test.pdf','crm.read') then raise exception 'Driver sees fleet documents';end if;
end $$;
reset role;
rollback;
select 'PASS: CRM writes, tenant isolation, cross-fleet vehicle/contact rejection, immutable identity, audit, insurer/accounts read-only, driver denial, file scope, insurance unchanged. All test data rolled back.' as result;
