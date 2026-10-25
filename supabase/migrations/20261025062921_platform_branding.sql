delete from public.role_permissions where permission='branding.manage' and role<>'platform_super_admin';
alter table public.org_branding add column logo_path text check(logo_path is null or (logo_path like insurer_id::text||'/%' and logo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'));

create function public.set_branding(p_insurer uuid,p_display_name text,p_accent text,p_logo_path text) returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_user();v_name text:=nullif(btrim(p_display_name),'');v_acc text:=nullif(btrim(p_accent),'');v_old public.org_branding;
begin
 if not exists(select 1 from public.memberships where user_id=v_user and active and role='platform_super_admin') then raise exception 'Only platform super admins can manage branding.' using errcode='42501';end if;
 if not exists(select 1 from public.organisations where id=p_insurer and kind='insurer') then raise exception 'Insurer not found.' using errcode='P0002';end if;
 if char_length(v_name)>60 or (v_acc is not null and v_acc !~ '^#[0-9A-Fa-f]{6}$') then raise exception 'Invalid branding details.' using errcode='22023';end if;
 if p_logo_path is not null and not exists(select 1 from storage.objects where bucket_id='insurer-logos' and name=p_logo_path and name like p_insurer::text||'/%') then raise exception 'Upload a logo for this insurer.' using errcode='22023';end if;
 select * into v_old from public.org_branding where insurer_id=p_insurer for update;
 insert into public.org_branding(insurer_id,display_name,accent,logo_path,updated_by) values(p_insurer,v_name,v_acc,p_logo_path,v_user)
 on conflict(insurer_id) do update set display_name=excluded.display_name,accent=excluded.accent,logo_path=excluded.logo_path,updated_by=v_user,updated_at=now();
 perform private.write_audit(p_insurer,'branding.changed','organisation',p_insurer,to_jsonb(v_old),jsonb_build_object('display_name',v_name,'accent',v_acc,'logo_path',p_logo_path));
end $$;
revoke all on function public.set_branding(uuid,text,text,text) from public,anon;
grant execute on function public.set_branding(uuid,text,text,text) to authenticated;
-- Existing clients retain the logo, and receive the same platform-only permission check.
create or replace function public.set_branding(p_insurer uuid,p_display_name text,p_accent text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_user();
 perform public.set_branding(p_insurer,p_display_name,p_accent,(select logo_path from public.org_branding where insurer_id=p_insurer));
end $$;

drop function public.my_branding();
create function public.my_branding() returns table(display_name text,accent text,logo_path text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_user();
 if exists(select 1 from public.memberships where user_id=auth.uid() and active and role='platform_super_admin') then return;end if;
 return query select b.display_name,b.accent,b.logo_path from public.memberships m
 join public.organisations o on o.id=m.organisation_id
 join public.org_branding b on b.insurer_id=case when o.kind='insurer' then o.id else o.insurer_id end
 where m.user_id=auth.uid() and m.active and o.kind<>'platform' order by m.created_at limit 1;
end $$;
revoke all on function public.my_branding() from public,anon;
grant execute on function public.my_branding() to authenticated;

-- Company logos are public image assets. Only MFA-authenticated platform editors can upload.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('insurer-logos','insurer-logos',true,4194304,array['image/png','image/jpeg','image/webp']);
create policy insurer_logo_insert on storage.objects for insert to authenticated with check(
 bucket_id='insurer-logos' and private.mfa_ok()
 and exists(select 1 from public.memberships where user_id=(select auth.uid()) and active and role='platform_super_admin')
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
 and exists(select 1 from public.organisations where kind='insurer' and id::text=split_part(name,'/',1)));
create policy insurer_logo_cleanup on storage.objects for delete to authenticated using(
 bucket_id='insurer-logos' and private.mfa_ok() and owner_id=(select auth.uid())::text
 and exists(select 1 from public.memberships where user_id=(select auth.uid()) and active and role='platform_super_admin')
 and not exists(select 1 from public.org_branding where logo_path=name));
