-- Vehicle additions outside a policy's agreed criteria are referred to the insurer instead of going straight on cover.
-- The insurer approves (cover starts then), queries (the customer answers) or declines. Pending vehicles are not on cover and not in any total.
-- A policy with no criteria set behaves exactly as before.

create function private.vehicle_types() returns text[] language sql immutable set search_path = '' as $$
  select array['van_3_5t', 'car', 'pickup', 'hgv', 'minibus', 'other']
$$;

alter table public.policy_terms add column auto_accept_types text[]
  check (auto_accept_types is null or (auto_accept_types <@ array['van_3_5t', 'car', 'pickup', 'hgv', 'minibus', 'other']));

insert into public.permissions (code, description) values ('referrals.decide', 'Approve, query or decline vehicle additions referred for authorisation');
insert into public.role_permissions (role, permission) values ('insurer_admin', 'referrals.decide'), ('platform_super_admin', 'referrals.decide');

drop function public.set_policy_terms(uuid, date, numeric, numeric, numeric, int, text);
create function public.set_policy_terms(
  p_policy uuid, p_effective_from date, p_commission_pct numeric, p_addition_fee numeric, p_removal_fee numeric,
  p_minimum_days int, p_note text default null, p_auto_accept_types text[] default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); p public.policies; v_id uuid;
begin
  select * into p from public.policies where id = p_policy;
  if not found or not private.has_permission(p.insurer_id, 'rates.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_effective_from is null then raise exception 'choose the date these terms start' using errcode = '22023'; end if;
  if p_auto_accept_types is not null and not (p_auto_accept_types <@ private.vehicle_types()) then raise exception 'unknown vehicle type' using errcode = '22023'; end if;
  begin
    insert into public.policy_terms (policy_id, insurer_id, effective_from, commission_pct, addition_fee, removal_fee, minimum_cover_days, note, created_by, auto_accept_types)
    values (p.id, p.insurer_id, p_effective_from, coalesce(p_commission_pct, 0), coalesce(p_addition_fee, 0), coalesce(p_removal_fee, 0),
            coalesce(p_minimum_days, 0), nullif(btrim(coalesce(p_note, '')), ''), v_user, p_auto_accept_types) returning id into v_id;
  exception
    when unique_violation then raise exception 'terms already start on that date; choose a later date' using errcode = '23505';
    when check_violation then raise exception 'check the figures: commission is 0 to 100, fees cannot be negative, minimum days 0 to 366' using errcode = '22023';
  end;
  perform private.write_audit(p.insurer_id, 'policy_terms.set', 'policy', p.id, null,
    jsonb_build_object('effective_from', p_effective_from, 'commission_pct', coalesce(p_commission_pct, 0), 'addition_fee', coalesce(p_addition_fee, 0),
                       'removal_fee', coalesce(p_removal_fee, 0), 'minimum_cover_days', coalesce(p_minimum_days, 0), 'auto_accept_types', p_auto_accept_types));
  return v_id;
end $$;
revoke all on function public.set_policy_terms(uuid, date, numeric, numeric, numeric, int, text, text[]) from public, anon;
grant execute on function public.set_policy_terms(uuid, date, numeric, numeric, numeric, int, text, text[]) to authenticated;

create table public.cover_referrals (
  id                     uuid primary key default gen_random_uuid(),
  fleet_id               uuid not null references public.organisations (id),
  insurer_id             uuid not null references public.organisations (id),
  policy_id              uuid not null,
  registration           text not null,
  make_model             text,
  vehicle_type           text not null check (vehicle_type = any (array['van_3_5t', 'car', 'pickup', 'hgv', 'minibus', 'other'])),
  requested_effective_at timestamptz not null,
  request_note           text check (request_note is null or char_length(request_note) <= 1000),
  status                 text not null default 'awaiting_authorisation'
                         check (status in ('awaiting_authorisation', 'queried', 'approved', 'declined', 'withdrawn')),
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  decided_at             timestamptz,
  decided_by             uuid,
  period_id              uuid references public.coverage_periods (id),
  foreign key (policy_id, fleet_id) references public.policies (id, fleet_id)
);
create index cover_referrals_insurer_idx on public.cover_referrals (insurer_id, status, created_at desc);
create index cover_referrals_fleet_idx on public.cover_referrals (fleet_id, created_at desc);
create unique index cover_referrals_one_open on public.cover_referrals (fleet_id, registration) where status in ('awaiting_authorisation', 'queried');

create table public.cover_referral_messages (
  id          uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.cover_referrals (id),
  fleet_id    uuid not null references public.organisations (id),
  side        text not null check (side in ('fleet', 'insurer')),
  author_id   uuid,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index cover_referral_messages_idx on public.cover_referral_messages (referral_id, created_at);
create trigger cover_referral_messages_append_only before update or delete on public.cover_referral_messages
  for each row execute function private.forbid_mutation();

alter table public.cover_referrals enable row level security;
alter table public.cover_referral_messages enable row level security;
create policy cover_referrals_read on public.cover_referrals for select to authenticated
  using (fleet_id in (select private.accessible_orgs('coverage.read')));
create policy cover_referral_messages_read on public.cover_referral_messages for select to authenticated
  using (fleet_id in (select private.accessible_orgs('coverage.read')));
revoke all on public.cover_referrals, public.cover_referral_messages from anon;
revoke insert, update, delete, truncate on public.cover_referrals, public.cover_referral_messages from authenticated;
grant select on public.cover_referrals, public.cover_referral_messages to authenticated;

-- Direct additions are refused on a policy that has criteria, unless they come through the referral path or the caller can decide referrals.
create or replace function public.add_vehicle_cover(
  p_fleet_id uuid, p_policy_id uuid, p_registration text, p_effective_at timestamptz,
  p_make_model text default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_fleet public.organisations;
  v_policy public.policies;
  v_reg text := private.normalise_registration(p_registration);
  v_tz text; v_eff_date date; v_vehicle uuid; v_period uuid; v_event uuid;
begin
  if not private.has_permission(p_fleet_id, 'coverage.add') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_fleet from public.organisations where id = p_fleet_id and kind = 'fleet';
  if not found then raise exception 'fleet not found' using errcode = 'P0002'; end if;
  if p_effective_at is null then raise exception 'effective date/time is required' using errcode = '22004'; end if;
  if not private.is_valid_registration(v_reg) then
    raise exception 'invalid registration number format: %', p_registration using errcode = '22023';
  end if;

  select * into v_policy from public.policies where id = p_policy_id and fleet_id = p_fleet_id;
  if not found then raise exception 'policy does not belong to this fleet' using errcode = '23503'; end if;

  v_tz := private.rules_timezone(v_fleet.insurer_id);
  v_eff_date := (p_effective_at at time zone v_tz)::date;
  if not v_policy.active or v_eff_date < v_policy.valid_from or (v_policy.valid_to is not null and v_eff_date > v_policy.valid_to) then
    raise exception 'policy is not active on %', v_eff_date using errcode = '23514';
  end if;
  if v_eff_date < (now() at time zone v_tz)::date and not private.has_permission(p_fleet_id, 'coverage.backdate') then
    raise exception 'backdated changes need the coverage.backdate permission (approval workflow not built yet)' using errcode = '42501';
  end if;
  if coalesce(current_setting('stratify.cover_ok', true), '') <> 'on'
     and not private.has_permission(v_fleet.insurer_id, 'referrals.decide')
     and exists (select 1 from public.policy_terms t where t.policy_id = p_policy_id and t.effective_from <= v_eff_date and t.auto_accept_types is not null
                  and t.effective_from = (select max(t2.effective_from) from public.policy_terms t2 where t2.policy_id = p_policy_id and t2.effective_from <= v_eff_date)) then
    raise exception 'this policy needs the vehicle type so the insurer can authorise it; use the add vehicle form' using errcode = '42501';
  end if;

  insert into public.vehicles (fleet_id, registration, make_model, created_by)
  values (p_fleet_id, v_reg, nullif(btrim(p_make_model), ''), v_user)
  on conflict (fleet_id, registration) do update
    set make_model = coalesce(public.vehicles.make_model, excluded.make_model)
  returning id into v_vehicle;

  begin
    insert into public.coverage_periods (vehicle_id, fleet_id, policy_id, cover_start, created_by)
    values (v_vehicle, p_fleet_id, p_policy_id, p_effective_at, v_user)
    returning id into v_period;
  exception when exclusion_violation then
    raise exception 'vehicle % already has cover overlapping that time', v_reg using errcode = '23P01';
  end;

  insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, actor_id, note, details)
  values (p_fleet_id, v_vehicle, v_period, 'cover_added', p_effective_at, v_user, p_note,
          jsonb_build_object('registration', v_reg, 'policy_id', p_policy_id))
  returning id into v_event;

  perform private.write_audit(p_fleet_id, 'coverage.added', 'coverage_period', v_period, null,
    jsonb_build_object('vehicle_id', v_vehicle, 'registration', v_reg, 'policy_id', p_policy_id, 'cover_start', p_effective_at), p_note);
  return v_period;
end $$;

-- The fleet's way to add a vehicle: straight on cover when within criteria, otherwise referred.
create function public.request_vehicle_cover(
  p_fleet_id uuid, p_policy_id uuid, p_registration text, p_effective_at timestamptz,
  p_make_model text, p_vehicle_type text, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_fleet public.organisations; v_policy public.policies;
  v_reg text := private.normalise_registration(p_registration);
  v_tz text; v_eff_date date; v_types text[]; v_terms_found boolean; v_id uuid; v_period uuid;
begin
  if not private.has_permission(p_fleet_id, 'coverage.add') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into v_fleet from public.organisations where id = p_fleet_id and kind = 'fleet';
  if not found then raise exception 'fleet not found' using errcode = 'P0002'; end if;
  if p_effective_at is null then raise exception 'effective date/time is required' using errcode = '22004'; end if;
  if not private.is_valid_registration(v_reg) then raise exception 'invalid registration number format: %', p_registration using errcode = '22023'; end if;
  if p_vehicle_type is null or not (p_vehicle_type = any (private.vehicle_types())) then raise exception 'choose the vehicle type' using errcode = '22023'; end if;
  select * into v_policy from public.policies where id = p_policy_id and fleet_id = p_fleet_id;
  if not found then raise exception 'policy does not belong to this fleet' using errcode = '23503'; end if;
  v_tz := private.rules_timezone(v_fleet.insurer_id);
  v_eff_date := (p_effective_at at time zone v_tz)::date;

  select t.auto_accept_types, true into v_types, v_terms_found from public.policy_terms t
   where t.policy_id = p_policy_id and t.effective_from <= v_eff_date order by t.effective_from desc limit 1;

  if v_types is null or p_vehicle_type = any (v_types) then
    perform set_config('stratify.cover_ok', 'on', true);
    v_period := public.add_vehicle_cover(p_fleet_id, p_policy_id, v_reg, p_effective_at, p_make_model, p_note);
    perform set_config('stratify.cover_ok', 'off', true);
    return jsonb_build_object('status', 'added', 'id', v_period);
  end if;

  if not v_policy.active or v_eff_date < v_policy.valid_from or (v_policy.valid_to is not null and v_eff_date > v_policy.valid_to) then
    raise exception 'policy is not active on %', v_eff_date using errcode = '23514';
  end if;
  if p_effective_at < now() - interval '2 minutes' then raise exception 'cover cannot start earlier than the moment it is requested' using errcode = '42501'; end if;
  if exists (select 1 from public.coverage_periods cp join public.vehicles v on v.id = cp.vehicle_id
              where v.registration = v_reg and cp.voided_at is null and (cp.cover_end is null or cp.cover_end > now())) then
    raise exception 'vehicle % already has cover', v_reg using errcode = '23P01';
  end if;
  begin
    insert into public.cover_referrals (fleet_id, insurer_id, policy_id, registration, make_model, vehicle_type, requested_effective_at, request_note, created_by)
    values (p_fleet_id, v_fleet.insurer_id, p_policy_id, v_reg, nullif(btrim(coalesce(p_make_model, '')), ''), p_vehicle_type, p_effective_at, nullif(btrim(coalesce(p_note, '')), ''), v_user)
    returning id into v_id;
  exception when unique_violation then raise exception 'vehicle % is already awaiting authorisation', v_reg using errcode = '23505';
  end;
  perform private.write_audit(p_fleet_id, 'cover.referred', 'cover_referral', v_id, null,
    jsonb_build_object('registration', v_reg, 'vehicle_type', p_vehicle_type, 'policy_id', p_policy_id, 'requested_effective_at', p_effective_at), p_note);
  return jsonb_build_object('status', 'referred', 'id', v_id);
end $$;

create function public.decide_cover_referral(p_referral uuid, p_decision text, p_message text default null, p_effective_at timestamptz default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); r public.cover_referrals; v_eff timestamptz; v_period uuid; v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into r from public.cover_referrals where id = p_referral for update;
  if not found or not private.has_permission(r.insurer_id, 'referrals.decide') then raise exception 'permission denied' using errcode = '42501'; end if;
  if r.status not in ('awaiting_authorisation', 'queried') then raise exception 'this request is already %', replace(r.status, '_', ' ') using errcode = '22023'; end if;
  if p_decision not in ('approve', 'query', 'decline') then raise exception 'choose approve, query or decline' using errcode = '22023'; end if;
  if p_decision in ('query', 'decline') and v_msg is null then raise exception 'write a message for the customer' using errcode = '22023'; end if;

  if p_decision = 'approve' then
    v_eff := coalesce(p_effective_at, greatest(r.requested_effective_at, now()));
    perform set_config('stratify.cover_ok', 'on', true);
    v_period := public.add_vehicle_cover(r.fleet_id, r.policy_id, r.registration, v_eff, r.make_model, 'Authorised by the insurer');
    perform set_config('stratify.cover_ok', 'off', true);
    update public.cover_referrals set status = 'approved', decided_at = now(), decided_by = v_user, updated_at = now(), period_id = v_period where id = r.id;
  elsif p_decision = 'query' then
    update public.cover_referrals set status = 'queried', updated_at = now() where id = r.id;
  else
    update public.cover_referrals set status = 'declined', decided_at = now(), decided_by = v_user, updated_at = now() where id = r.id;
  end if;
  if v_msg is not null then
    insert into public.cover_referral_messages (referral_id, fleet_id, side, author_id, body) values (r.id, r.fleet_id, 'insurer', v_user, v_msg);
  end if;
  perform private.write_audit(r.fleet_id, 'cover.referral_' || case p_decision when 'approve' then 'approved' when 'query' then 'queried' else 'declined' end,
    'cover_referral', r.id, jsonb_build_object('status', r.status), jsonb_build_object('registration', r.registration, 'decision', p_decision), v_msg);
  return case p_decision when 'approve' then 'approved' when 'query' then 'queried' else 'declined' end;
end $$;

create function public.respond_cover_referral(p_referral uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); r public.cover_referrals;
begin
  select * into r from public.cover_referrals where id = p_referral for update;
  if not found or not private.has_permission(r.fleet_id, 'coverage.add') then raise exception 'permission denied' using errcode = '42501'; end if;
  if r.status <> 'queried' then raise exception 'there is no open question on this request' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'write your answer' using errcode = '22023'; end if;
  insert into public.cover_referral_messages (referral_id, fleet_id, side, author_id, body) values (r.id, r.fleet_id, 'fleet', v_user, btrim(p_body));
  update public.cover_referrals set status = 'awaiting_authorisation', updated_at = now() where id = r.id;
  perform private.write_audit(r.fleet_id, 'cover.referral_answered', 'cover_referral', r.id, null, jsonb_build_object('registration', r.registration), null);
end $$;

create function public.withdraw_cover_referral(p_referral uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); r public.cover_referrals;
begin
  select * into r from public.cover_referrals where id = p_referral for update;
  if not found or not private.has_permission(r.fleet_id, 'coverage.add') then raise exception 'permission denied' using errcode = '42501'; end if;
  if r.status not in ('awaiting_authorisation', 'queried') then raise exception 'this request is already %', replace(r.status, '_', ' ') using errcode = '22023'; end if;
  update public.cover_referrals set status = 'withdrawn', updated_at = now(), decided_at = now(), decided_by = v_user where id = r.id;
  perform private.write_audit(r.fleet_id, 'cover.referral_withdrawn', 'cover_referral', r.id, null, jsonb_build_object('registration', r.registration), null);
end $$;

revoke all on function public.request_vehicle_cover(uuid, uuid, text, timestamptz, text, text, text), public.decide_cover_referral(uuid, text, text, timestamptz),
  public.respond_cover_referral(uuid, text), public.withdraw_cover_referral(uuid) from public, anon;
grant execute on function public.request_vehicle_cover(uuid, uuid, text, timestamptz, text, text, text), public.decide_cover_referral(uuid, text, text, timestamptz),
  public.respond_cover_referral(uuid, text), public.withdraw_cover_referral(uuid) to authenticated;
