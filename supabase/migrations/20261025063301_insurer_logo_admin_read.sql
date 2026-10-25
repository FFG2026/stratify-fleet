-- Storage DELETE needs SELECT visibility too, for failed-upload cleanup.
create policy insurer_logo_admin_read on storage.objects for select to authenticated using(
 bucket_id='insurer-logos' and private.mfa_ok()
 and exists(select 1 from public.memberships where user_id=(select auth.uid()) and active and role='platform_super_admin'));
