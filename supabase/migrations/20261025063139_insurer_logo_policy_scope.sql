-- Qualify the object name inside the insurer lookup (organisations also has a name column).
alter policy insurer_logo_insert on storage.objects with check(
 bucket_id='insurer-logos' and private.mfa_ok()
 and exists(select 1 from public.memberships where user_id=(select auth.uid()) and active and role='platform_super_admin')
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|webp)$'
 and exists(select 1 from public.organisations where kind='insurer' and id::text=split_part(storage.objects.name,'/',1)));
