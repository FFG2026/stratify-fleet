begin;
select set_config('stratify.test_user',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('stratify.test_user')::uuid,'report-test@example.invalid');
insert into public.memberships(user_id,organisation_id,role) values(current_setting('stratify.test_user')::uuid,'20000000-0000-4000-8000-000000000001','fleet_accounts');
select set_config('request.jwt.claim.sub',current_setting('stratify.test_user'),true);
set local role authenticated;
do $test$
declare r uuid; total integer;
begin
 r:=public.generate_reconciliation('20000000-0000-4000-8000-000000000001',date_trunc('month',current_date)::date,null);
 select sum(days) into total from public.reconciliation_lines where reconciliation_id=r;
 if total is null or total<1 then raise exception 'FAIL empty reconciliation'; end if;
 if not exists(select 1 from public.reconciliations where id=r and total_vehicle_days=total and status='provisional' and rules_snapshot is not null) then raise exception 'FAIL report total/snapshot'; end if;
 if exists(select 1 from public.reconciliation_lines where reconciliation_id=r and (days<1 or days>31)) then raise exception 'FAIL calendar days'; end if;
 if exists(select 1 from public.reconciliation_lines where fleet_id<>'20000000-0000-4000-8000-000000000001') then raise exception 'FAIL report tenant leakage'; end if;
end $test$;
reset role;
rollback;
select 'PASS saved provisional reconciliation, snapshot, positive day lines, totals and tenant isolation; rolled back' as result;