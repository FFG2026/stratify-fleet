-- Run only after creating the intended user in Supabase Auth.
-- Replace the placeholder with that user's VERIFIED Auth UUID.
-- This intentionally raises an error until it has been edited.
do $$
declare
 v_user uuid := '00000000-0000-0000-0000-000000000000';
 v_platform uuid;
begin
 if v_user='00000000-0000-0000-0000-000000000000' or not exists(select 1 from auth.users where id=v_user) then
  raise exception 'Replace the placeholder with the verified Auth user UUID first';
 end if;
 select id into strict v_platform from public.organisations where kind='platform';
 insert into public.memberships(user_id,organisation_id,role)
 values(v_user,v_platform,'platform_super_admin');
end $$;
