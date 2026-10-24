-- National driver database (opt-in) and insurer search.
-- A driver may separately choose to appear in a national database that any insurer using the portal can search.
-- It is its own consent (never bundled with the fleet or licence-check permissions), can be withdrawn at any time
-- (the driver then stops appearing in searches immediately), and every search and every record opened is written to the audit log.
-- The Fleet CRM is for fleets only, so insurer admins lose crm.read.

delete from public.role_permissions where role = 'insurer_admin' and permission = 'crm.read';

alter table public.driver_consents drop constraint driver_consents_kind_check;
alter table public.driver_consents add constraint driver_consents_kind_check check (kind in ('licence_check','data_sharing','national_database'));

create or replace function public.record_driver_consent(p_kind text, p_given boolean, p_version text, p_statement text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet();
begin
  if v_fleet is null then raise exception 'only drivers can give consent' using errcode = '42501'; end if;
  if p_kind not in ('licence_check','data_sharing','national_database') then raise exception 'unknown consent' using errcode = '22023'; end if;
  if coalesce(p_version, '') = '' or coalesce(p_statement, '') = '' then raise exception 'consent wording is missing' using errcode = '22023'; end if;
  insert into public.driver_consents (user_id, fleet_id, kind, given, version, statement) values (v_user, v_fleet, p_kind, coalesce(p_given, false), p_version, p_statement);
  perform private.write_audit(v_fleet, case when p_given then 'driver.consent_given' else 'driver.consent_withdrawn' end, 'driver', v_user, null,
    jsonb_build_object('consent', p_kind, 'version', p_version));
end $$;

insert into public.permissions (code, description) values ('driver.national_search', 'Search the national driver database (drivers who opted in)');
insert into public.role_permissions (role, permission) values
  ('platform_super_admin','driver.national_search'), ('insurer_admin','driver.national_search'), ('insurer_claims','driver.national_search');

-- The organisation the searcher acts for (their own insurer, or the platform). Null if they may not search.
create function private.national_searcher() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.organisation_id from public.memberships m
   where m.user_id = (select auth.uid()) and m.active
     and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'driver.national_search')
   order by m.created_at limit 1
$$;
grant execute on function private.national_searcher() to authenticated;

-- Search by name. A date of birth narrows the result; without one only the year of birth is shown.
create function public.search_national_drivers(p_name text, p_dob date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.national_searcher(); v_name text := btrim(coalesce(p_name, '')); v_rows jsonb;
begin
  perform private.require_user();
  if v_org is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(v_name) < 3 then raise exception 'type at least three letters of the name' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(x order by x->>'full_name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name, 'birth_year', extract(year from p.date_of_birth)::integer,
             'date_of_birth', case when p_dob is not null then p.date_of_birth end, 'fleet_name', o.name) as x
      from public.driver_profiles p
      join public.organisations o on o.id = p.fleet_id
      join public.driver_consent_current c on c.user_id = p.user_id and c.kind = 'national_database' and c.given
     where p.full_name ilike '%' || replace(replace(replace(v_name, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       and (p_dob is null or p.date_of_birth = p_dob)
     order by p.full_name limit 25) q;
  perform private.write_audit(v_org, 'driver.national_search', 'driver', null, null,
    jsonb_build_object('name', v_name, 'dob_given', p_dob is not null, 'results', jsonb_array_length(v_rows)));
  return v_rows;
end $$;

-- Open one driver's shared history. Fails if the driver has withdrawn or never opted in.
create function public.national_driver_file(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.national_searcher(); v_p public.driver_profiles; v_c record; v_fleet text; v_records jsonb;
begin
  perform private.require_user();
  if v_org is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into v_c from public.driver_consent_current where user_id = p_user and kind = 'national_database';
  if v_c.user_id is null or not v_c.given then raise exception 'this driver is not in the national database' using errcode = '42501'; end if;
  select * into v_p from public.driver_profiles where user_id = p_user;
  if v_p.user_id is null then raise exception 'this driver is not in the national database' using errcode = '42501'; end if;
  select name into v_fleet from public.organisations where id = v_p.fleet_id;
  select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'title', r.title, 'detail', r.detail, 'start_date', r.start_date, 'end_date', r.end_date,
           'amount', r.amount, 'at_fault', r.at_fault, 'points', r.points) order by r.start_date desc), '[]'::jsonb)
    into v_records from public.driver_records r where r.user_id = p_user and r.deleted_at is null;
  perform private.write_audit(v_org, 'driver.national_viewed', 'driver', p_user, null, jsonb_build_object('consent_version', v_c.version));
  return jsonb_build_object('user_id', p_user, 'full_name', v_p.full_name, 'date_of_birth', v_p.date_of_birth, 'fleet_name', v_fleet,
    'no_claims_declared_at', v_p.no_claims_declared_at, 'no_convictions_declared_at', v_p.no_convictions_declared_at,
    'shared_since', v_c.recorded_at, 'records', v_records);
end $$;

revoke all on function public.search_national_drivers(text, date), public.national_driver_file(uuid) from public, anon;
grant execute on function public.search_national_drivers(text, date), public.national_driver_file(uuid) to authenticated;
