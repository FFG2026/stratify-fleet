-- Onboarding: create insurers, customers (fleets) and policies from the portal, with the first administrator invited at the same time.
-- Who can do what (development assumptions, to be reviewed):
--   * Only platform administrators create insurers and move a customer to another insurer.
--   * Platform administrators and an insurer's own admins create that insurer's customers and manage their policies.
--   * Every action is written to the audit log. Nothing is deleted.

insert into public.permissions (code, description) values
  ('org.manage',      'Create insurers and move a customer to another insurer (platform only)'),
  ('customer.manage', 'Create customers (fleets) of an insurer'),
  ('policy.manage',   'Create, end and renew policies');
insert into public.role_permissions (role, permission) values
  ('platform_super_admin','org.manage'), ('platform_super_admin','customer.manage'), ('platform_super_admin','policy.manage'),
  ('insurer_admin','customer.manage'), ('insurer_admin','policy.manage');

create unique index organisations_name_unique on public.organisations (kind, lower(btrim(name)));

-- The moment a vehicle was first put on cover survives a policy renewal, so renewing never makes a vehicle look newly added.
alter table public.coverage_periods add column first_recorded_at timestamptz;

create function private.platform_org() returns uuid
language sql stable security definer set search_path = '' as $$ select id from public.organisations where kind = 'platform' limit 1 $$;

create function public.create_insurer(p_name text, p_admin_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id uuid; v_how text;
begin
  perform private.require_user();
  if not private.has_permission(private.platform_org(), 'org.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'enter the insurer''s name' using errcode = '22023'; end if;
  begin insert into public.organisations (kind, name) values ('insurer', v_name) returning id into v_id;
  exception when unique_violation then raise exception 'an insurer with that name already exists' using errcode = '23505'; end;
  v_how := public.add_member(v_id, p_admin_email, 'insurer_admin');
  perform private.write_audit(v_id, 'organisation.created', 'organisation', v_id, null, jsonb_build_object('kind', 'insurer', 'name', v_name, 'first_admin', lower(btrim(p_admin_email)), 'admin_result', v_how));
  return v_id;
end $$;

create function public.create_customer(p_insurer uuid, p_name text, p_admin_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id uuid; v_how text;
begin
  perform private.require_user();
  if not exists (select 1 from public.organisations where id = p_insurer and kind = 'insurer') then raise exception 'insurer not found' using errcode = 'P0002'; end if;
  if not private.has_permission(p_insurer, 'customer.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'enter the customer''s name' using errcode = '22023'; end if;
  begin insert into public.organisations (kind, name, insurer_id) values ('fleet', v_name, p_insurer) returning id into v_id;
  exception when unique_violation then raise exception 'a customer with that name already exists' using errcode = '23505'; end;
  v_how := public.add_member(v_id, p_admin_email, 'fleet_admin');
  perform private.write_audit(v_id, 'organisation.created', 'organisation', v_id, null, jsonb_build_object('kind', 'fleet', 'name', v_name, 'insurer_id', p_insurer, 'first_admin', lower(btrim(p_admin_email)), 'admin_result', v_how));
  return v_id;
end $$;

create function public.create_policy(p_fleet uuid, p_number text, p_name text, p_from date, p_to date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_f public.organisations; v_num text := btrim(coalesce(p_number, '')); v_id uuid;
begin
  perform private.require_user();
  select * into v_f from public.organisations where id = p_fleet and kind = 'fleet';
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if not private.has_permission(v_f.insurer_id, 'policy.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(v_num) < 2 or char_length(v_num) > 60 then raise exception 'enter the policy number' using errcode = '22023'; end if;
  if p_from is null then raise exception 'enter the date the policy starts' using errcode = '22004'; end if;
  if p_to is not null and p_to < p_from then raise exception 'the policy cannot end before it starts' using errcode = '22023'; end if;
  begin insert into public.policies (insurer_id, fleet_id, policy_number, name, valid_from, valid_to) values (v_f.insurer_id, p_fleet, v_num, nullif(btrim(coalesce(p_name, '')), ''), p_from, p_to) returning id into v_id;
  exception when unique_violation then raise exception 'that insurer already has a policy with that number' using errcode = '23505'; end;
  perform private.write_audit(p_fleet, 'policy.created', 'policy', v_id, null, jsonb_build_object('policy_number', v_num, 'valid_from', p_from, 'valid_to', p_to));
  return v_id;
end $$;

-- Sets the last day of a policy. Vehicles still on cover are not touched: remove them or renew the policy.
create function public.end_policy(p_policy uuid, p_valid_to date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.policies;
begin
  perform private.require_user();
  select * into v_p from public.policies where id = p_policy;
  if not found or not private.has_permission(v_p.insurer_id, 'policy.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_valid_to is null or p_valid_to < v_p.valid_from then raise exception 'the last day cannot be before the policy starts' using errcode = '22023'; end if;
  update public.policies set valid_to = p_valid_to where id = p_policy;
  perform private.write_audit(v_p.fleet_id, 'policy.ended', 'policy', p_policy, jsonb_build_object('valid_to', v_p.valid_to), jsonb_build_object('valid_to', p_valid_to));
end $$;

-- Renewal: a new policy that starts at p_from, the old one ends the day before, and every vehicle on open cover moves across
-- with no gap or overlap. The original "added to the portal" time of each vehicle is kept.
create function public.renew_policy(p_policy uuid, p_new_number text, p_from date, p_to date, p_rate numeric default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_old public.policies; v_new uuid; v_tz text; v_boundary timestamptz; v_n int := 0; r public.coverage_periods; v_num text := btrim(coalesce(p_new_number, ''));
begin
  perform private.require_user();
  select * into v_old from public.policies where id = p_policy;
  if not found or not private.has_permission(v_old.insurer_id, 'policy.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_from is null or p_from <= v_old.valid_from then raise exception 'the new policy must start after the old one started' using errcode = '22023'; end if;
  if p_to is not null and p_to < p_from then raise exception 'the new policy cannot end before it starts' using errcode = '22023'; end if;
  if p_rate is not null and p_rate < 0 then raise exception 'the daily rate cannot be negative' using errcode = '22023'; end if;
  v_tz := private.rules_timezone(v_old.insurer_id, p_from);
  v_boundary := (p_from::timestamp) at time zone v_tz;
  if v_boundary < now() - interval '2 minutes' and not private.has_permission(v_old.fleet_id, 'coverage.backdate') then
    raise exception 'renewing from a date in the past needs the backdate permission' using errcode = '42501';
  end if;
  if exists (select 1 from public.coverage_periods where policy_id = p_policy and voided_at is null and (cover_start >= v_boundary or (cover_end is not null and cover_end > v_boundary))) then
    raise exception 'some vehicles on this policy start or end after the renewal date; cancel or complete those changes first' using errcode = '23514';
  end if;
  begin insert into public.policies (insurer_id, fleet_id, policy_number, name, valid_from, valid_to) values (v_old.insurer_id, v_old.fleet_id, v_num, v_old.name, p_from, p_to) returning id into v_new;
  exception when unique_violation then raise exception 'that insurer already has a policy with that number' using errcode = '23505'; end;
  for r in select * from public.coverage_periods where policy_id = p_policy and voided_at is null and cover_end is null and cover_start < v_boundary for update loop
    update public.coverage_periods set cover_end = v_boundary, closed_at = now(), closed_by = (select auth.uid()) where id = r.id;
    insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start, created_by, first_recorded_at)
      values (r.vehicle_id, r.fleet_id, v_new, v_boundary, (select auth.uid()), coalesce(r.first_recorded_at, r.created_at));
    v_n := v_n + 1;
  end loop;
  update public.policies set valid_to = p_from - 1 where id = p_policy and (valid_to is null or valid_to >= p_from);
  if p_rate is not null then
    insert into public.rate_cards (policy_id, fleet_id, effective_from, daily_rate, note, created_by) values (v_new, v_old.fleet_id, p_from, p_rate, 'Set at renewal', (select auth.uid()));
  end if;
  perform private.write_audit(v_old.fleet_id, 'policy.renewed', 'policy', v_new, jsonb_build_object('policy_id', p_policy, 'policy_number', v_old.policy_number),
    jsonb_build_object('policy_number', v_num, 'valid_from', p_from, 'valid_to', p_to, 'vehicles_carried_over', v_n, 'daily_rate', p_rate));
  return v_new;
end $$;

-- Moves a customer to a different insurer. Platform only, and only when nothing live depends on the old insurer.
-- The old insurer stops seeing that customer's history (policies, claims, reports) from the moment this runs.
create function public.change_customer_insurer(p_fleet uuid, p_new_insurer uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f public.organisations;
begin
  perform private.require_user();
  if not private.has_permission(private.platform_org(), 'org.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into v_f from public.organisations where id = p_fleet and kind = 'fleet';
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.organisations where id = p_new_insurer and kind = 'insurer') then raise exception 'insurer not found' using errcode = 'P0002'; end if;
  if v_f.insurer_id = p_new_insurer then raise exception 'that customer already belongs to that insurer' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why the customer is moving' using errcode = '22023'; end if;
  if exists (select 1 from public.policies where fleet_id = p_fleet and (valid_to is null or valid_to >= current_date)) then
    raise exception 'end the customer''s current policies first' using errcode = '23514'; end if;
  if exists (select 1 from public.coverage_periods where fleet_id = p_fleet and voided_at is null and (cover_end is null or cover_end > now())) then
    raise exception 'take every vehicle off cover first' using errcode = '23514'; end if;
  if exists (select 1 from public.claims where fleet_id = p_fleet and status <> 'closed') then
    raise exception 'close the customer''s open claims first' using errcode = '23514'; end if;
  update public.organisations set insurer_id = p_new_insurer where id = p_fleet;
  perform private.write_audit(p_fleet, 'organisation.insurer_changed', 'organisation', p_fleet, jsonb_build_object('insurer_id', v_f.insurer_id), jsonb_build_object('insurer_id', p_new_insurer), btrim(p_note));
end $$;

revoke all on function public.create_insurer(text, text), public.create_customer(uuid, text, text), public.create_policy(uuid, text, text, date, date),
  public.end_policy(uuid, date), public.renew_policy(uuid, text, date, date, numeric), public.change_customer_insurer(uuid, uuid, text) from public, anon;
grant execute on function public.create_insurer(text, text), public.create_customer(uuid, text, text), public.create_policy(uuid, text, text, date, date),
  public.end_policy(uuid, date), public.renew_policy(uuid, text, date, date, numeric), public.change_customer_insurer(uuid, uuid, text) to authenticated;
revoke all on function private.platform_org() from public, anon, authenticated;
