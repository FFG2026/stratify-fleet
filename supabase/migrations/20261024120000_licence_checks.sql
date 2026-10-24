-- Manual DVLA licence checks. The driver generates a check code on gov.uk and gives it to us; staff use the code and the last
-- 8 characters of the licence number on the DVLA site, then record the result here. Nothing is sent to the DVLA from the portal.
insert into public.permissions (code, description) values ('driver.check', 'Record the result of a driver licence check');
insert into public.role_permissions (role, permission) values
  ('platform_super_admin','driver.check'), ('insurer_admin','driver.check'), ('insurer_claims','driver.check'),
  ('fleet_admin','driver.check'), ('fleet_manager','driver.check');

create table public.driver_check_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id),
  fleet_id   uuid not null references public.organisations (id),
  code       text not null check (code ~ '^[A-Za-z0-9 ]{6,16}$'),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index driver_check_codes_user_idx on public.driver_check_codes (user_id, created_at desc);

create table public.licence_checks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id),
  fleet_id      uuid not null references public.organisations (id),
  checked_by    uuid not null,
  checked_by_email text,
  checked_at    timestamptz not null default now(),
  status        text not null check (status in ('valid','not_valid','could_not_check')),
  points        integer check (points is null or points between 0 and 36),
  entitlements  text check (entitlements is null or char_length(entitlements) <= 200),
  endorsements  text check (endorsements is null or char_length(endorsements) <= 500),
  notes         text check (notes is null or char_length(notes) <= 500),
  next_check_due date,
  code_id       uuid references public.driver_check_codes (id)
);
create index licence_checks_user_idx on public.licence_checks (user_id, checked_at desc);

alter table public.driver_check_codes enable row level security;
alter table public.licence_checks enable row level security;
create policy driver_check_codes_read on public.driver_check_codes for select to authenticated
  using (user_id = (select auth.uid()) or fleet_id in (select private.accessible_orgs('driver.read')));
create policy licence_checks_read on public.licence_checks for select to authenticated
  using (user_id = (select auth.uid()) or fleet_id in (select private.accessible_orgs('driver.read')));
revoke insert, update, delete, truncate on public.driver_check_codes, public.licence_checks from anon, authenticated;
revoke all on public.driver_check_codes, public.licence_checks from anon;

create function public.add_check_code(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet(); v_id uuid; v_code text := btrim(coalesce(p_code, ''));
begin
  if v_fleet is null then raise exception 'only drivers can add a check code' using errcode = '42501'; end if;
  if v_code !~ '^[A-Za-z0-9 ]{6,16}$' then raise exception 'check the code: it is letters and numbers only' using errcode = '22023'; end if;
  if not coalesce((select given from public.driver_consent_current where user_id = v_user and kind = 'licence_check'), false) then
    raise exception 'give the licence check permission first' using errcode = '22023'; end if;
  insert into public.driver_check_codes (user_id, fleet_id, code) values (v_user, v_fleet, v_code) returning id into v_id;
  perform private.write_audit(v_fleet, 'driver.check_code_added', 'driver', v_user, null, null);
  return v_id;
end $$;

create function public.record_licence_check(p_driver uuid, p_status text, p_points integer, p_entitlements text, p_endorsements text, p_notes text, p_next_due date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_user(); v_fleet uuid; v_id uuid; v_code uuid;
begin
  select fleet_id into v_fleet from public.driver_profiles where user_id = p_driver;
  if v_fleet is null or not private.has_permission(v_fleet, 'driver.check') then
    raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('valid','not_valid','could_not_check') then raise exception 'choose the result of the check' using errcode = '22023'; end if;
  if not coalesce((select given from public.driver_consent_current where user_id = p_driver and kind = 'licence_check'), false) then
    raise exception 'the driver has not given permission for licence checks' using errcode = '22023'; end if;
  select id into v_code from public.driver_check_codes where user_id = p_driver and used_at is null order by created_at desc limit 1;
  if v_code is not null then update public.driver_check_codes set used_at = now() where id = v_code; end if;
  insert into public.licence_checks (user_id, fleet_id, checked_by, checked_by_email, status, points, entitlements, endorsements, notes, next_check_due, code_id)
  values (p_driver, v_fleet, v_actor, (select email from auth.users where id = v_actor), p_status, p_points,
          nullif(btrim(coalesce(p_entitlements, '')), ''), nullif(btrim(coalesce(p_endorsements, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), p_next_due, v_code)
  returning id into v_id;
  perform private.write_audit(v_fleet, 'driver.licence_checked', 'licence_check', v_id, null, jsonb_build_object('user_id', p_driver, 'status', p_status));
  return v_id;
end $$;

revoke all on function public.add_check_code(text), public.record_licence_check(uuid, text, integer, text, text, text, date) from public, anon;
grant execute on function public.add_check_code(text), public.record_licence_check(uuid, text, integer, text, text, text, date) to authenticated;
