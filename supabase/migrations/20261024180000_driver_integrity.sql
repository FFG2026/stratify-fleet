-- Driver integrity: a person is an active driver for one customer at a time; switching a driver off or moving them
-- ends their vehicle assignments and hides their records from the customer they have left; a former driver can still
-- be found (and withdraw) in the national database; the same registration cannot be on cover for two customers at once.

-- 1. Deterministic "current fleet" for a driver.
create or replace function private.driver_fleet() returns uuid
language sql stable security definer set search_path = '' as $$
  select organisation_id from public.memberships where user_id = (select auth.uid()) and role = 'driver' and active order by created_at, id limit 1
$$;

-- 2. One active driver membership per person.
create function private.one_active_driver() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'driver' and new.active and exists (
       select 1 from public.memberships m where m.user_id = new.user_id and m.role = 'driver' and m.active
          and m.organisation_id <> new.organisation_id and m.id <> new.id) then
    raise exception 'this person is already a driver for another customer; they must be switched off there before they can be added here' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger memberships_one_active_driver before insert or update of role, active on public.memberships
  for each row execute function private.one_active_driver();

-- Sign-in must never fail because of one blocked invitation: leave it pending and carry on.
create or replace function public.claim_invitations() returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_email text; v_n int := 0; r public.invitations;
begin
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for r in select * from public.invitations where email = v_email and claimed_at is null and revoked_at is null for update loop
    begin
      insert into public.memberships (user_id, organisation_id, role) values (v_uid, r.organisation_id, r.role)
        on conflict (user_id, organisation_id) do nothing;
    exception when unique_violation then continue;
    end;
    update public.invitations set claimed_at = now(), claimed_by = v_uid where id = r.id;
    perform private.write_audit(r.organisation_id, 'invitation.claimed', 'invitation', r.id, null, jsonb_build_object('email', v_email, 'role', r.role));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 3. Leaving and joining.
create function private.driver_membership_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prev uuid; v_kind text;
begin
  -- switched off, or no longer a driver: their open vehicle assignments in that customer end
  if tg_op = 'UPDATE' and old.role = 'driver' and old.active and (not new.active or new.role <> 'driver') then
    update public.vehicle_assignments set assigned_to = greatest(current_date, assigned_from)
     where user_id = new.user_id and fleet_id = new.organisation_id and assigned_to is null;
    perform private.write_audit(new.organisation_id, 'driver.left', 'driver', new.user_id, null, null);
  end if;
  -- joining (or rejoining) as an active driver
  if new.role = 'driver' and new.active and (tg_op = 'INSERT' or not old.active or old.role <> 'driver') then
    select fleet_id into v_prev from public.driver_profiles where user_id = new.user_id;
    if v_prev is not null and v_prev <> new.organisation_id then
      -- moved to a different customer: the profile follows them; uploaded documents and permissions given to the previous customer do not
      update public.driver_profiles set fleet_id = new.organisation_id, updated_at = now() where user_id = new.user_id;
      update public.driver_documents set deleted_at = now() where user_id = new.user_id and fleet_id <> new.organisation_id and deleted_at is null;
      for v_kind in select unnest(array['licence_check', 'data_sharing']) loop
        if exists (select 1 from public.driver_consent_current c where c.user_id = new.user_id and c.kind = v_kind and c.given) then
          insert into public.driver_consents (user_id, fleet_id, kind, given, version, statement)
          values (new.user_id, new.organisation_id, v_kind, false, 'system', 'Reset automatically when the driver joined a different customer. It must be given again for the new customer.');
        end if;
      end loop;
      perform private.write_audit(new.organisation_id, 'driver.moved_in', 'driver', new.user_id, null, null);
    end if;
  end if;
  return null;
end $$;
create trigger memberships_driver_changed after insert or update of role, active on public.memberships
  for each row execute function private.driver_membership_changed();

-- 4. Staff see a driver's records only while the driver is currently active in that customer.
create function private.active_driver_in(p_user uuid, p_fleet uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where user_id = p_user and organisation_id = p_fleet and role = 'driver' and active)
$$;
grant execute on function private.active_driver_in(uuid, uuid) to authenticated;
create function private.driver_file_visible(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.driver_documents d
                  where d.storage_path = p_name and d.deleted_at is null
                    and private.active_driver_in(d.user_id, d.fleet_id))
$$;
grant execute on function private.driver_file_visible(text) to authenticated;

drop policy driver_profiles_read on public.driver_profiles;
drop policy driver_documents_read on public.driver_documents;
drop policy driver_consents_read on public.driver_consents;
drop policy driver_records_read on public.driver_records;
create policy driver_profiles_read  on public.driver_profiles  for select to authenticated
  using (user_id = (select auth.uid()) or (fleet_id in (select private.accessible_orgs('driver.read')) and private.active_driver_in(user_id, fleet_id)));
create policy driver_documents_read on public.driver_documents for select to authenticated
  using (deleted_at is null and (user_id = (select auth.uid()) or (fleet_id in (select private.accessible_orgs('driver.read')) and private.active_driver_in(user_id, fleet_id))));
create policy driver_consents_read  on public.driver_consents  for select to authenticated
  using (user_id = (select auth.uid()) or (fleet_id in (select private.accessible_orgs('driver.read')) and private.active_driver_in(user_id, fleet_id)));
create policy driver_records_read   on public.driver_records   for select to authenticated
  using (deleted_at is null and (user_id = (select auth.uid()) or (fleet_id in (select private.accessible_orgs('driver.read')) and private.active_driver_in(user_id, fleet_id))));

drop policy driver_files_read on storage.objects;
create policy driver_files_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents'
    and ((storage.foldername(name))[2] = (select auth.uid())::text
      or ((storage.foldername(name))[1] in (select a::text from private.accessible_orgs('driver.read') a) and private.driver_file_visible(name))));

-- 5. National database: a driver who has left a customer is still found, shown without a current customer.
create or replace function public.search_national_drivers(p_name text, p_dob date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.national_searcher(); v_name text := btrim(coalesce(p_name, '')); v_rows jsonb;
begin
  perform private.require_user();
  if v_org is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(v_name) < 3 then raise exception 'type at least three letters of the name' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(x order by x->>'full_name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name, 'birth_year', extract(year from p.date_of_birth)::integer,
             'date_of_birth', case when p_dob is not null then p.date_of_birth end, 'fleet_name', cur.name) as x
      from public.driver_profiles p
      join public.driver_consent_current c on c.user_id = p.user_id and c.kind = 'national_database' and c.given
      left join lateral (select o.name from public.memberships m join public.organisations o on o.id = m.organisation_id
                          where m.user_id = p.user_id and m.role = 'driver' and m.active order by m.created_at limit 1) cur on true
     where p.full_name ilike '%' || replace(replace(replace(v_name, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       and (p_dob is null or p.date_of_birth = p_dob)
     order by p.full_name limit 25) q;
  perform private.write_audit(v_org, 'driver.national_search', 'driver', null, null,
    jsonb_build_object('name', v_name, 'dob_given', p_dob is not null, 'results', jsonb_array_length(v_rows)));
  return v_rows;
end $$;

create or replace function public.national_driver_file(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.national_searcher(); v_p public.driver_profiles; v_c record; v_fleet text; v_records jsonb;
begin
  perform private.require_user();
  if v_org is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into v_c from public.driver_consent_current where user_id = p_user and kind = 'national_database';
  if v_c.user_id is null or not v_c.given then raise exception 'this driver is not in the national database' using errcode = '42501'; end if;
  select * into v_p from public.driver_profiles where user_id = p_user;
  if v_p.user_id is null then raise exception 'this driver is not in the national database' using errcode = '42501'; end if;
  select o.name into v_fleet from public.memberships m join public.organisations o on o.id = m.organisation_id
   where m.user_id = p_user and m.role = 'driver' and m.active order by m.created_at limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'title', r.title, 'detail', r.detail, 'start_date', r.start_date, 'end_date', r.end_date,
           'amount', r.amount, 'at_fault', r.at_fault, 'points', r.points) order by r.start_date desc), '[]'::jsonb)
    into v_records from public.driver_records r where r.user_id = p_user and r.deleted_at is null;
  perform private.write_audit(v_org, 'driver.national_viewed', 'driver', p_user, null, jsonb_build_object('consent_version', v_c.version));
  return jsonb_build_object('user_id', p_user, 'full_name', v_p.full_name, 'date_of_birth', v_p.date_of_birth, 'fleet_name', v_fleet,
    'no_claims_declared_at', v_p.no_claims_declared_at, 'no_convictions_declared_at', v_p.no_convictions_declared_at,
    'shared_since', v_c.recorded_at, 'records', v_records);
end $$;

-- A driver who has left every customer can still withdraw from the national database.
create or replace function public.record_driver_consent(p_kind text, p_given boolean, p_version text, p_statement text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet();
begin
  if v_fleet is null and p_kind = 'national_database' then
    select fleet_id into v_fleet from public.driver_profiles where user_id = v_user;
  end if;
  if v_fleet is null then raise exception 'only drivers can give consent' using errcode = '42501'; end if;
  if p_kind not in ('licence_check','data_sharing','national_database') then raise exception 'unknown consent' using errcode = '22023'; end if;
  if coalesce(p_version, '') = '' or coalesce(p_statement, '') = '' then raise exception 'consent wording is missing' using errcode = '22023'; end if;
  insert into public.driver_consents (user_id, fleet_id, kind, given, version, statement) values (v_user, v_fleet, p_kind, coalesce(p_given, false), p_version, p_statement);
  perform private.write_audit(v_fleet, case when p_given then 'driver.consent_given' else 'driver.consent_withdrawn' end, 'driver', v_user, null,
    jsonb_build_object('consent', p_kind, 'version', p_version));
end $$;

-- 6. The same registration cannot be on cover for two customers at the same time.
create function private.one_cover_per_registration() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_reg text;
begin
  if new.voided_at is not null then return new; end if;
  select registration into v_reg from public.vehicles where id = new.vehicle_id;
  if exists (
       select 1 from public.coverage_periods p join public.vehicles v on v.id = p.vehicle_id
        where v.registration = v_reg and p.fleet_id <> new.fleet_id and p.voided_at is null and p.id <> new.id
          and tstzrange(p.cover_start, p.cover_end) && tstzrange(new.cover_start, new.cover_end)) then
    raise exception 'this registration cannot be put on cover for these dates; check the registration or contact your insurer' using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger coverage_periods_one_per_registration before insert or update of cover_start, cover_end, voided_at on public.coverage_periods
  for each row execute function private.one_cover_per_registration();

revoke all on function private.one_active_driver(), private.driver_membership_changed(), private.one_cover_per_registration() from public, anon, authenticated;
