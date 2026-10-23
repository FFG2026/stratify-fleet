create function private.normalise_registration(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create function private.is_valid_registration(p text) returns boolean
language sql immutable as $$
  select p ~ '^([A-Z]{2}[0-9]{2}[A-Z]{3}|[A-Z][0-9]{1,3}[A-Z]{3}|[A-Z]{3}[0-9]{1,3}[A-Z]|[A-Z]{1,3}[0-9]{1,4}|[0-9]{1,4}[A-Z]{1,3})$'
$$;

create table public.policies (
  id            uuid primary key default gen_random_uuid(),
  insurer_id    uuid not null references public.organisations (id),
  fleet_id      uuid not null references public.organisations (id),
  policy_number text not null check (length(btrim(policy_number)) > 0),
  name          text,
  valid_from    date not null,
  valid_to      date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (insurer_id, policy_number),
  unique (id, fleet_id),
  check (valid_to is null or valid_to >= valid_from)
);
create index policies_fleet_idx on public.policies (fleet_id);

create function private.check_policy_links() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.organisations f where f.id = new.fleet_id and f.kind = 'fleet' and f.insurer_id = new.insurer_id) then
    raise exception 'policy fleet must be a fleet customer of the policy insurer' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger policies_check_links before insert or update on public.policies
  for each row execute function private.check_policy_links();

create table public.vehicles (
  id           uuid primary key default gen_random_uuid(),
  fleet_id     uuid not null references public.organisations (id),
  registration text not null,
  make_model   text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  constraint vehicles_registration_format check (private.is_valid_registration(registration)),
  unique (fleet_id, registration),
  unique (id, fleet_id)
);
create index vehicles_registration_trgm on public.vehicles using gin (registration extensions.gin_trgm_ops);
create index vehicles_fleet_reg_idx on public.vehicles (fleet_id, registration);

create table public.coverage_periods (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null,
  fleet_id    uuid not null,
  policy_id   uuid not null,
  cover_start timestamptz not null,
  cover_end   timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  closed_at   timestamptz,
  closed_by   uuid,
  voided_at   timestamptz,
  voided_by   uuid,
  void_reason text,
  foreign key (vehicle_id, fleet_id) references public.vehicles (id, fleet_id),
  foreign key (policy_id, fleet_id)  references public.policies (id, fleet_id),
  constraint coverage_end_after_start check (cover_end is null or cover_end > cover_start),
  constraint coverage_void_consistent check ((voided_at is null) = (void_reason is null)),
  constraint coverage_no_overlap exclude using gist (
    vehicle_id with =,
    tstzrange(cover_start, cover_end, '[)') with &&
  ) where (voided_at is null)
);
create index coverage_periods_vehicle_idx on public.coverage_periods (vehicle_id, cover_start desc) where voided_at is null;
create index coverage_periods_fleet_range_idx on public.coverage_periods (fleet_id, cover_start, cover_end) where voided_at is null;

create function private.guard_coverage_period() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'coverage periods cannot be deleted; void with a reason instead' using errcode = '55000';
  end if;
  if new.vehicle_id <> old.vehicle_id or new.fleet_id <> old.fleet_id or new.policy_id <> old.policy_id
     or new.cover_start <> old.cover_start or new.created_at <> old.created_at then
    raise exception 'coverage period identity fields are immutable; void and re-add instead' using errcode = '55000';
  end if;
  if old.cover_end is not null and new.cover_end is distinct from old.cover_end then
    raise exception 'a closed coverage period cannot be edited; void and re-add instead' using errcode = '55000';
  end if;
  if old.voided_at is not null and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'a voided coverage period cannot be changed' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger coverage_periods_guard before update or delete on public.coverage_periods
  for each row execute function private.guard_coverage_period();

create table public.coverage_events (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.organisations (id),
  vehicle_id  uuid not null references public.vehicles (id),
  period_id   uuid not null references public.coverage_periods (id),
  event_type  text not null check (event_type in ('cover_added', 'cover_removed', 'cover_voided')),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id    uuid,
  note        text,
  details     jsonb not null default '{}'::jsonb
);
create index coverage_events_vehicle_idx on public.coverage_events (vehicle_id, recorded_at desc);
create index coverage_events_fleet_idx on public.coverage_events (fleet_id, recorded_at desc);
create trigger coverage_events_append_only before update or delete on public.coverage_events
  for each row execute function private.forbid_mutation();

create table public.mipd_submissions (
  id                uuid primary key default gen_random_uuid(),
  fleet_id          uuid not null references public.organisations (id),
  coverage_event_id uuid not null unique references public.coverage_events (id),
  submission_status text not null default 'not_submitted'
    check (submission_status in ('not_submitted', 'queued', 'submitted', 'accepted', 'rejected', 'error')),
  is_simulation     boolean not null default false,
  status_detail     text,
  external_reference text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index mipd_submissions_fleet_status_idx on public.mipd_submissions (fleet_id, submission_status);

create function private.queue_mipd_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.event_type in ('cover_added', 'cover_removed') then
    insert into public.mipd_submissions (fleet_id, coverage_event_id, status_detail)
    values (new.fleet_id, new.id, 'Integration not configured; nothing has been transmitted.');
  end if;
  return new;
end $$;
create trigger coverage_events_queue_mipd after insert on public.coverage_events
  for each row execute function private.queue_mipd_record();

create table public.rate_cards (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null,
  fleet_id       uuid not null,
  effective_from date not null,
  daily_rate     numeric(12,4) not null check (daily_rate >= 0),
  currency       char(3) not null default 'GBP',
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  foreign key (policy_id, fleet_id) references public.policies (id, fleet_id),
  unique (policy_id, effective_from)
);
create trigger rate_cards_append_only before update or delete on public.rate_cards
  for each row execute function private.forbid_mutation();

create table public.billing_rules (
  id                uuid primary key default gen_random_uuid(),
  insurer_id        uuid not null references public.organisations (id),
  effective_from    date not null,
  start_day_charged boolean not null,
  end_day_charged   boolean not null,
  timezone          text not null,
  rounding_dp       int  not null check (rounding_dp between 0 and 4),
  vat_rate          numeric(6,4) not null check (vat_rate >= 0),
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  unique (insurer_id, effective_from)
);
create trigger billing_rules_append_only before update or delete on public.billing_rules
  for each row execute function private.forbid_mutation();

alter table public.policies          enable row level security;
alter table public.vehicles          enable row level security;
alter table public.coverage_periods  enable row level security;
alter table public.coverage_events   enable row level security;
alter table public.mipd_submissions  enable row level security;
alter table public.rate_cards        enable row level security;
alter table public.billing_rules     enable row level security;

create policy policies_read on public.policies for select to authenticated
  using (fleet_id in (select private.accessible_orgs('policy.read')));
create policy vehicles_read on public.vehicles for select to authenticated
  using (fleet_id in (select private.accessible_orgs('vehicle.read')));
create policy coverage_periods_read on public.coverage_periods for select to authenticated
  using (fleet_id in (select private.accessible_orgs('coverage.read')));
create policy coverage_events_read on public.coverage_events for select to authenticated
  using (fleet_id in (select private.accessible_orgs('coverage.read')));
create policy mipd_submissions_read on public.mipd_submissions for select to authenticated
  using (fleet_id in (select private.accessible_orgs('mipd.read')));
create policy rate_cards_read on public.rate_cards for select to authenticated
  using (fleet_id in (select private.accessible_orgs('rates.read')));
create policy billing_rules_read on public.billing_rules for select to authenticated
  using (insurer_id in (select private.accessible_orgs('rates.read')));

revoke all on public.policies, public.vehicles, public.coverage_periods, public.coverage_events,
              public.mipd_submissions, public.rate_cards, public.billing_rules from anon, authenticated;
grant select on public.policies, public.vehicles, public.coverage_periods, public.coverage_events,
                public.mipd_submissions, public.rate_cards, public.billing_rules to authenticated;

create view public.vehicle_cover_status with (security_invoker = true) as
select v.id, v.fleet_id, v.registration, v.make_model, v.created_at,
       cp.id as period_id, cp.policy_id, cp.cover_start, cp.cover_end,
       case
         when cp.id is null then 'never_covered'
         when cp.cover_start > now() then 'scheduled'
         when cp.cover_end is null or cp.cover_end > now() then 'on_cover'
         else 'off_cover'
       end as cover_status
from public.vehicles v
left join lateral (
  select c.* from public.coverage_periods c
  where c.vehicle_id = v.id and c.voided_at is null
  order by (c.cover_start <= now() and (c.cover_end is null or c.cover_end > now())) desc, c.cover_start desc
  limit 1
) cp on true;

create view public.fleet_overview with (security_invoker = true) as
select o.id as fleet_id, o.name as fleet_name, o.insurer_id,
       count(s.id)                                         as vehicles_total,
       count(s.id) filter (where s.cover_status = 'on_cover')  as vehicles_on_cover,
       count(s.id) filter (where s.cover_status = 'scheduled') as vehicles_scheduled
from public.organisations o
left join public.vehicle_cover_status s on s.fleet_id = o.id
where o.kind = 'fleet'
group by o.id, o.name, o.insurer_id;

grant select on public.vehicle_cover_status, public.fleet_overview to authenticated;

create function private.rules_timezone(p_insurer uuid, p_on date default current_date) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select timezone from public.billing_rules where insurer_id = p_insurer and effective_from <= p_on
      order by effective_from desc limit 1),
    'Europe/London')
$$;

create function private.require_user() returns uuid
language plpgsql stable as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return v;
end $$;

create function public.add_vehicle_cover(
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

create function public.remove_vehicle_cover(
  p_vehicle_id uuid, p_effective_at timestamptz, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_vehicle public.vehicles;
  v_period public.coverage_periods;
  v_insurer uuid; v_tz text;
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found or not private.has_permission(v_vehicle.fleet_id, 'coverage.remove') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_effective_at is null then raise exception 'effective date/time is required' using errcode = '22004'; end if;

  select insurer_id into v_insurer from public.organisations where id = v_vehicle.fleet_id;
  v_tz := private.rules_timezone(v_insurer);
  if (p_effective_at at time zone v_tz)::date < (now() at time zone v_tz)::date
     and not private.has_permission(v_vehicle.fleet_id, 'coverage.backdate') then
    raise exception 'backdated changes need the coverage.backdate permission (approval workflow not built yet)' using errcode = '42501';
  end if;

  select * into v_period from public.coverage_periods
   where vehicle_id = p_vehicle_id and voided_at is null and cover_end is null
   for update;
  if not found then raise exception 'vehicle has no open coverage period' using errcode = 'P0002'; end if;
  if p_effective_at <= v_period.cover_start then
    raise exception 'removal must be after cover started (%)', v_period.cover_start using errcode = '22023';
  end if;

  update public.coverage_periods
     set cover_end = p_effective_at, closed_at = now(), closed_by = v_user
   where id = v_period.id;

  insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, actor_id, note, details)
  values (v_vehicle.fleet_id, p_vehicle_id, v_period.id, 'cover_removed', p_effective_at, v_user, p_note,
          jsonb_build_object('registration', v_vehicle.registration, 'policy_id', v_period.policy_id));

  perform private.write_audit(v_vehicle.fleet_id, 'coverage.removed', 'coverage_period', v_period.id,
    jsonb_build_object('cover_end', null),
    jsonb_build_object('vehicle_id', p_vehicle_id, 'registration', v_vehicle.registration, 'cover_end', p_effective_at), p_note);
  return v_period.id;
end $$;

create function public.void_coverage_period(p_period_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_period public.coverage_periods;
begin
  select * into v_period from public.coverage_periods where id = p_period_id;
  if not found or not private.has_permission(v_period.fleet_id, 'coverage.correct') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'a reason of at least 5 characters is required' using errcode = '22023';
  end if;
  if v_period.voided_at is not null then raise exception 'period is already voided' using errcode = '55000'; end if;

  update public.coverage_periods set voided_at = now(), voided_by = v_user, void_reason = btrim(p_reason) where id = p_period_id;

  insert into public.coverage_events (fleet_id, vehicle_id, period_id, event_type, effective_at, actor_id, note, details)
  values (v_period.fleet_id, v_period.vehicle_id, p_period_id, 'cover_voided', v_period.cover_start, v_user, btrim(p_reason),
          jsonb_build_object('original_start', v_period.cover_start, 'original_end', v_period.cover_end));

  perform private.write_audit(v_period.fleet_id, 'coverage.voided', 'coverage_period', p_period_id,
    jsonb_build_object('cover_start', v_period.cover_start, 'cover_end', v_period.cover_end), null, btrim(p_reason));
end $$;

create function public.set_daily_rate(p_policy_id uuid, p_effective_from date, p_daily_rate numeric, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_policy public.policies; v_id uuid;
begin
  select * into v_policy from public.policies where id = p_policy_id;
  if not found or not private.has_permission(v_policy.insurer_id, 'rates.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.rate_cards (policy_id, fleet_id, effective_from, daily_rate, note, created_by)
  values (p_policy_id, v_policy.fleet_id, p_effective_from, p_daily_rate, p_note, v_user) returning id into v_id;
  perform private.write_audit(v_policy.fleet_id, 'rate.added', 'rate_card', v_id, null,
    jsonb_build_object('policy_id', p_policy_id, 'effective_from', p_effective_from, 'daily_rate', p_daily_rate), p_note);
  return v_id;
end $$;

create function public.set_billing_rules(
  p_insurer_id uuid, p_effective_from date, p_start_day_charged boolean, p_end_day_charged boolean,
  p_timezone text, p_rounding_dp int, p_vat_rate numeric, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_id uuid;
begin
  if not private.has_permission(p_insurer_id, 'rates.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %', p_timezone using errcode = '22023';
  end if;
  insert into public.billing_rules (insurer_id, effective_from, start_day_charged, end_day_charged, timezone, rounding_dp, vat_rate, note, created_by)
  values (p_insurer_id, p_effective_from, p_start_day_charged, p_end_day_charged, p_timezone, p_rounding_dp, p_vat_rate, p_note, v_user)
  returning id into v_id;
  perform private.write_audit(p_insurer_id, 'billing_rules.added', 'billing_rules', v_id, null,
    jsonb_build_object('effective_from', p_effective_from, 'start_day_charged', p_start_day_charged,
      'end_day_charged', p_end_day_charged, 'timezone', p_timezone, 'rounding_dp', p_rounding_dp, 'vat_rate', p_vat_rate), p_note);
  return v_id;
end $$;

revoke all on function public.add_vehicle_cover(uuid, uuid, text, timestamptz, text, text),
                       public.remove_vehicle_cover(uuid, timestamptz, text),
                       public.void_coverage_period(uuid, text),
                       public.set_daily_rate(uuid, date, numeric, text),
                       public.set_billing_rules(uuid, date, boolean, boolean, text, int, numeric, text)
  from public, anon;
grant execute on function public.add_vehicle_cover(uuid, uuid, text, timestamptz, text, text),
                          public.remove_vehicle_cover(uuid, timestamptz, text),
                          public.void_coverage_period(uuid, text),
                          public.set_daily_rate(uuid, date, numeric, text),
                          public.set_billing_rules(uuid, date, boolean, boolean, text, int, numeric, text)
  to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.has_permission(uuid, text), private.accessible_orgs(text), private.my_orgs(),
                          private.is_valid_registration(text), private.normalise_registration(text)
  to authenticated;
