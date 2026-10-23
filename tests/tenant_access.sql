begin;
-- Temporary identities and membership rows are rolled back with all test changes.
select set_config('stratify.test_user',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('stratify.test_user')::uuid,'portal-test@example.invalid');
insert into public.memberships(user_id,organisation_id,role)
values(current_setting('stratify.test_user')::uuid,'20000000-0000-4000-8000-000000000001','fleet_admin');
select set_config('request.jwt.claim.sub',current_setting('stratify.test_user'),true);
set local role authenticated;
do $test$
declare p uuid; c uuid; c2 uuid; v uuid; n int;
begin
 if exists(select 1 from public.vehicles where fleet_id<>'20000000-0000-4000-8000-000000000001') then raise exception 'FAIL cross-tenant read'; end if;
 if (select count(*) from public.vehicles)=0 then raise exception 'FAIL own fleet unavailable'; end if;
 select id into p from public.policies where fleet_id='20000000-0000-4000-8000-000000000001' limit 1;
 c := public.add_vehicle_cover('20000000-0000-4000-8000-000000000001',p,'ZZ99ZZZ',((current_date+1)::timestamp at time zone 'Europe/London'),'Portal test');
 select vehicle_id into v from public.coverage_periods where id=c;
 begin
  perform public.add_vehicle_cover('20000000-0000-4000-8000-000000000001',p,'ZZ99ZZZ',((current_date+1)::timestamp at time zone 'Europe/London'),'Overlap test');
  raise exception 'FAIL overlap allowed';
 exception when exclusion_violation then null; end;
 perform public.remove_vehicle_cover(v,((current_date+2)::timestamp at time zone 'Europe/London'),'Portal test removal');
 c2 := public.add_vehicle_cover('20000000-0000-4000-8000-000000000001',p,'ZZ99ZZZ',((current_date+3)::timestamp at time zone 'Europe/London'),'Readdition test');
 if c=c2 then raise exception 'FAIL coverage history replaced'; end if;
 if not exists(select 1 from public.audit_logs where action='coverage.removed' and entity_id=c) then raise exception 'FAIL audit missing'; end if;
 if not exists(select 1 from public.mipd_submissions where submission_status='not_submitted' and not is_simulation) then raise exception 'FAIL MID pending record missing'; end if;
 begin
  update public.vehicles set registration='AA11AAA' where id=v;
  raise exception 'FAIL direct mutation allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.remove_vehicle_cover((select id from public.vehicles limit 1),((current_date-1)::timestamp at time zone 'Europe/London'),'Backdate test');
  raise exception 'FAIL backdating allowed';
 exception when insufficient_privilege then null; end;
end $test$;
-- A signed-in identity with no membership must see zero rows and cannot call RPCs.
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $test$ begin
 if exists(select 1 from public.vehicles) or exists(select 1 from public.policies) or exists(select 1 from public.coverage_periods) then raise exception 'FAIL membershipless read'; end if;
 begin
  perform public.add_vehicle_cover('20000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','ZZ99ZZZ',now(),'Denied test');
  raise exception 'FAIL membershipless write';
 exception when insufficient_privilege then null; end;
end $test$;
reset role;
rollback;
select 'PASS: own fleet read, cross-tenant read denial, add/remove/readd, overlap rejection, audit/MID records, direct write denial, backdate denial, membershipless denial; all changes rolled back' as result;