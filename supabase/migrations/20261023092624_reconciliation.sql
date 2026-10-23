create table public.reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  fleet_id           uuid not null references public.organisations (id),
  policy_id          uuid references public.policies (id),
  month_start        date not null check (extract(day from month_start) = 1),
  status             text not null default 'provisional' check (status in ('provisional', 'locked')),
  rules_source       text not null,
  rules_snapshot     jsonb not null,
  currency           char(3) not null default 'GBP',
  generated_at       timestamptz not null default now(),
  generated_by       uuid,
  opening_vehicles   int,
  additions          int,
  removals           int,
  closing_vehicles   int,
  total_vehicle_days int,
  premium_net        numeric(14,2),
  vat_amount         numeric(14,2),
  premium_gross      numeric(14,2)
);
create index reconciliations_fleet_month_idx on public.reconciliations (fleet_id, month_start desc, generated_at desc);

create table public.reconciliation_lines (
  id                 bigint generated always as identity primary key,
  reconciliation_id  uuid not null references public.reconciliations (id),
  fleet_id           uuid not null references public.organisations (id),
  vehicle_id         uuid not null references public.vehicles (id),
  registration       text not null,
  policy_id          uuid not null references public.policies (id),
  coverage_period_id uuid not null references public.coverage_periods (id),
  first_charged_date date not null,
  last_charged_date  date not null,
  days               int not null check (days > 0),
  daily_rate         numeric(12,4) not null,
  charge             numeric(14,2) not null
);
create index reconciliation_lines_recon_idx on public.reconciliation_lines (reconciliation_id, registration, first_charged_date);
create trigger reconciliation_lines_append_only before update or delete on public.reconciliation_lines
  for each row execute function private.forbid_mutation();
create function private.forbid_reconciliation_delete() returns trigger
language plpgsql as $$ begin raise exception 'reconciliations cannot be deleted' using errcode = '55000'; end $$;
create trigger reconciliations_no_delete before delete on public.reconciliations
  for each row execute function private.forbid_reconciliation_delete();

alter table public.reconciliations      enable row level security;
alter table public.reconciliation_lines enable row level security;
create policy reconciliations_read on public.reconciliations for select to authenticated
  using (fleet_id in (select private.accessible_orgs('reconciliation.read')));
create policy reconciliation_lines_read on public.reconciliation_lines for select to authenticated
  using (fleet_id in (select private.accessible_orgs('reconciliation.read')));
revoke all on public.reconciliations, public.reconciliation_lines from anon, authenticated;
grant select on public.reconciliations, public.reconciliation_lines to authenticated;

create function private.missing_rate(p_policy uuid, p_day date) returns numeric
language plpgsql as $$
begin
  raise exception 'no rate card for policy % on %; add a rate before reconciling', p_policy, p_day using errcode = 'P0001';
end $$;

create function public.generate_reconciliation(p_fleet_id uuid, p_month date, p_policy_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_fleet public.organisations;
  v_rules public.billing_rules;
  v_source text;
  v_start_charged boolean := true;
  v_end_charged boolean := true;
  v_tz text := 'Europe/London';
  v_dp int := 2;
  v_vat numeric := 0;
  v_ms date := date_trunc('month', p_month)::date;
  v_me date;
  v_ms_ts timestamptz;
  v_next_ts timestamptz;
  v_id uuid;
  v_open int; v_add int; v_rem int; v_close int; v_days int; v_net numeric; v_vat_amt numeric;
begin
  if not private.has_permission(p_fleet_id, 'reconciliation.generate') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_fleet from public.organisations where id = p_fleet_id and kind = 'fleet';
  if not found then raise exception 'fleet not found' using errcode = 'P0002'; end if;
  if p_policy_id is not null and not exists (select 1 from public.policies where id = p_policy_id and fleet_id = p_fleet_id) then
    raise exception 'policy does not belong to this fleet' using errcode = '23503';
  end if;

  select * into v_rules from public.billing_rules
   where insurer_id = v_fleet.insurer_id and effective_from <= v_ms order by effective_from desc limit 1;
  if found then
    v_source := 'billing_rules:' || v_rules.id::text;
    v_start_charged := v_rules.start_day_charged; v_end_charged := v_rules.end_day_charged;
    v_tz := v_rules.timezone; v_dp := v_rules.rounding_dp; v_vat := v_rules.vat_rate;
  else
    v_source := 'default-assumption';
  end if;

  if v_ms > (now() at time zone v_tz)::date then
    raise exception 'cannot reconcile a month that has not started' using errcode = '22023';
  end if;
  v_me := (v_ms + interval '1 month')::date - 1;
  v_ms_ts := v_ms::timestamp at time zone v_tz;
  v_next_ts := (v_me + 1)::timestamp at time zone v_tz;

  insert into public.reconciliations (fleet_id, policy_id, month_start, rules_source, rules_snapshot, generated_by)
  values (p_fleet_id, p_policy_id, v_ms, v_source,
          jsonb_build_object('start_day_charged', v_start_charged, 'end_day_charged', v_end_charged,
                             'timezone', v_tz, 'rounding_dp', v_dp, 'vat_rate', v_vat,
                             'provisional_notice', 'Billing rules are not agreed; development assumptions may apply.'),
          v_user)
  returning id into v_id;

  insert into public.reconciliation_lines
    (reconciliation_id, fleet_id, vehicle_id, registration, policy_id, coverage_period_id,
     first_charged_date, last_charged_date, days, daily_rate, charge)
  with periods as (
    select cp.id, cp.vehicle_id, v.registration, cp.policy_id, cp.cover_start, cp.cover_end
    from public.coverage_periods cp
    join public.vehicles v on v.id = cp.vehicle_id
    where cp.fleet_id = p_fleet_id and cp.voided_at is null
      and (p_policy_id is null or cp.policy_id = p_policy_id)
      and cp.cover_start < v_next_ts
      and (cp.cover_end is null or cp.cover_end > v_ms_ts)
  ), bounds as (
    select p.*,
      greatest(v_ms, (p.cover_start at time zone v_tz)::date + case when v_start_charged then 0 else 1 end) as first_d,
      least(v_me, case when p.cover_end is null then v_me
                       when v_end_charged then ((p.cover_end - interval '1 microsecond') at time zone v_tz)::date
                       else (p.cover_end at time zone v_tz)::date - 1 end) as last_d
    from periods p
  ), days as (
    select distinct on (b.vehicle_id, g::date) b.id, b.vehicle_id, b.registration, b.policy_id, g::date as day
    from bounds b
    cross join lateral generate_series(b.first_d::timestamp, b.last_d::timestamp, interval '1 day') g
    where b.first_d <= b.last_d
    order by b.vehicle_id, g::date, b.cover_start desc
  ), rated as (
    select d.*, r.effective_from as seg, coalesce(r.daily_rate, private.missing_rate(d.policy_id, d.day)) as rate
    from days d
    left join lateral (
      select rc.effective_from, rc.daily_rate from public.rate_cards rc
      where rc.policy_id = d.policy_id and rc.effective_from <= d.day
      order by rc.effective_from desc limit 1
    ) r on true
  )
  select v_id, p_fleet_id, vehicle_id, registration, policy_id, id,
         min(day), max(day), count(*)::int, rate, round(count(*) * rate, v_dp)
  from rated
  group by id, vehicle_id, registration, policy_id, seg, rate;

  select count(*) into v_open from public.coverage_periods cp
   where cp.fleet_id = p_fleet_id and cp.voided_at is null and (p_policy_id is null or cp.policy_id = p_policy_id)
     and cp.cover_start < v_ms_ts and (cp.cover_end is null or cp.cover_end >= v_ms_ts);
  select count(*) into v_add from public.coverage_periods cp
   where cp.fleet_id = p_fleet_id and cp.voided_at is null and (p_policy_id is null or cp.policy_id = p_policy_id)
     and cp.cover_start >= v_ms_ts and cp.cover_start < v_next_ts;
  select count(*) into v_rem from public.coverage_periods cp
   where cp.fleet_id = p_fleet_id and cp.voided_at is null and (p_policy_id is null or cp.policy_id = p_policy_id)
     and cp.cover_end >= v_ms_ts and cp.cover_end < v_next_ts;
  select count(*) into v_close from public.coverage_periods cp
   where cp.fleet_id = p_fleet_id and cp.voided_at is null and (p_policy_id is null or cp.policy_id = p_policy_id)
     and cp.cover_start < v_next_ts and (cp.cover_end is null or cp.cover_end >= v_next_ts);

  select coalesce(sum(days), 0), coalesce(sum(charge), 0) into v_days, v_net
    from public.reconciliation_lines where reconciliation_id = v_id;
  v_vat_amt := round(v_net * v_vat, 2);

  update public.reconciliations
     set opening_vehicles = v_open, additions = v_add, removals = v_rem, closing_vehicles = v_close,
         total_vehicle_days = v_days, premium_net = v_net, vat_amount = v_vat_amt, premium_gross = v_net + v_vat_amt
   where id = v_id;

  perform private.write_audit(p_fleet_id, 'reconciliation.generated', 'reconciliation', v_id, null,
    jsonb_build_object('month_start', v_ms, 'policy_id', p_policy_id, 'status', 'provisional',
                       'rules_source', v_source, 'premium_net', v_net, 'total_vehicle_days', v_days));
  return v_id;
end $$;

revoke all on function public.generate_reconciliation(uuid, date, uuid) from public, anon;
grant execute on function public.generate_reconciliation(uuid, date, uuid) to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.has_permission(uuid, text), private.accessible_orgs(text), private.my_orgs(),
                          private.is_valid_registration(text), private.normalise_registration(text)
  to authenticated;
