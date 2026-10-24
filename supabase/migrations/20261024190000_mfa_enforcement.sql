-- Two-factor sign-in enforced in the database, not only in the app.
-- A person with a verified authenticator factor gets no organisation data and cannot run any function until their session
-- has passed the second step (JWT assurance level aal2). People without a factor are unaffected.
create function private.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;
grant execute on function private.mfa_ok() to authenticated;

create or replace function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'complete two-factor sign-in first' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function private.accessible_orgs(p_perm text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id
  from public.organisations o
  where private.mfa_ok() and exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role and rp.permission = p_perm
    join public.organisations mo on mo.id = m.organisation_id
    where m.user_id = (select auth.uid())
      and m.active
      and (
        o.id = m.organisation_id
        or (mo.kind = 'insurer' and o.insurer_id = mo.id)
        or mo.kind = 'platform'
      )
  )
$$;
