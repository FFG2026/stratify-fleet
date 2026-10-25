begin;
select set_config('brand.p',gen_random_uuid()::text,true),set_config('brand.i',gen_random_uuid()::text,true),set_config('brand.f',gen_random_uuid()::text,true),set_config('brand.logo','10000000-0000-4000-8000-000000000002/'||gen_random_uuid()||'.png',true);
insert into auth.users(id,email) values(current_setting('brand.p')::uuid,'brand-platform@example.invalid'),(current_setting('brand.i')::uuid,'brand-insurer@example.invalid'),(current_setting('brand.f')::uuid,'brand-fleet@example.invalid');
insert into public.memberships(user_id,organisation_id,role) values
(current_setting('brand.p')::uuid,(select id from public.organisations where kind='platform' limit 1),'platform_super_admin'),
(current_setting('brand.i')::uuid,'10000000-0000-4000-8000-000000000002','insurer_admin'),
(current_setting('brand.f')::uuid,'20000000-0000-4000-8000-000000000001','fleet_admin');
select set_config('request.jwt.claims',json_build_object('sub',current_setting('brand.p'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
insert into storage.objects(bucket_id,name,owner_id) values('insurer-logos',current_setting('brand.logo'),current_setting('brand.p'));
select public.set_branding('10000000-0000-4000-8000-000000000002','Platform-managed test','#1a5c4b',current_setting('brand.logo'));
select public.set_branding('10000000-0000-4000-8000-000000000002','Platform-managed test','#1a5c4b');
do $$ begin
 if (select logo_path from public.org_branding where insurer_id='10000000-0000-4000-8000-000000000002') is distinct from current_setting('brand.logo') then raise exception 'Legacy API lost logo';end if;
 if exists(select 1 from public.my_branding()) then raise exception 'Platform inherited insurer branding';end if;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('brand.i'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ declare r record;begin
 begin perform public.set_branding('10000000-0000-4000-8000-000000000002','Forbidden','#000000');raise exception 'Insurer legacy edit allowed';exception when insufficient_privilege then null;end;
 begin perform public.set_branding('10000000-0000-4000-8000-000000000002','Forbidden','#000000',null);raise exception 'Insurer logo edit allowed';exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name,owner_id) values('insurer-logos','10000000-0000-4000-8000-000000000002/'||gen_random_uuid()||'.png',current_setting('brand.i'));raise exception 'Insurer uploaded logo';exception when insufficient_privilege then null;end;
 select * into r from public.my_branding();if r.display_name is distinct from 'Platform-managed test' or r.logo_path is distinct from current_setting('brand.logo') then raise exception 'Insurer lost assigned branding';end if;
 if exists(select 1 from public.org_branding) then raise exception 'Insurer sees admin settings';end if;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('brand.f'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ declare r record;begin
 select * into r from public.my_branding();if r.display_name is distinct from 'Platform-managed test' or r.logo_path is distinct from current_setting('brand.logo') then raise exception 'Fleet lost assigned branding';end if;
 begin perform public.set_branding('10000000-0000-4000-8000-000000000002','Forbidden','#000000',null);raise exception 'Fleet edit allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: platform edits/upload, insurer and fleet edit denial, legacy API denial/preservation, assigned branding remains visible; all records rolled back.' as result;
