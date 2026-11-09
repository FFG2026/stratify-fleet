-- Per-policy remuneration and minimum cover period, plus the insurer's monthly bordereau.
-- Terms are set by the insurer on each policy it writes: commission %, an admin fee for each vehicle addition and each removal,
-- and a minimum cover period (a vehicle removed early is still billed up to that many days from when it was added).
-- Terms are effective-dated and append-only, like rates. They are never visible to the fleet.

create table public.policy_terms (
  id                 uuid primary key default gen_random_uuid(),
  policy_id          uuid not null references public.policies (id),
  insurer_id         uuid not null references public.organisations (id),
  effective_from     date not null,
  commission_pct     numeric(6,3) not null default 0 check (commission_pct between 0 and 100),
  addition_fee       numeric(10,2) not null default 0 check (addition_fee >= 0),
  removal_fee        numeric(10,2) not null default 0 check (removal_fee >= 0),
  minimum_cover_days int not null default 0 check (minimum_cover_days between 0 and 366),
  note               text check (note is null or char_length(note) <= 500),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  unique (policy_id, effective_from)
);
create index policy_terms_insurer_idx on public.policy_terms (insurer_id, policy_id, effective_from desc);
create trigger policy_terms_append_only before update or delete on public.policy_terms
  for each row execute function private.forbid_mutation();
alter table public.policy_terms enable row level security;
create policy policy_terms_read on public.policy_terms for select to authenticated
  using (insurer_id in (select private.accessible_orgs('rates.read')));
revoke all on public.policy_terms from anon;
revoke insert, update, delete, truncate on public.policy_terms from authenticated;
grant select on public.policy_terms to authenticated;

create function public.set_policy_terms(
  p_policy uuid, p_effective_from date, p_commission_pct numeric, p_addition_fee numeric, p_removal_fee numeric,
  p_minimum_days int, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); p public.policies; v_id uuid;
begin
  select * into p from public.policies where id = p_policy;
  if not found or not private.has_permission(p.insurer_id, 'rates.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_effective_from is null then raise exception 'choose the date these terms start' using errcode = '22023'; end if;
  begin
    insert into public.policy_terms (policy_id, insurer_id, effective_from, commission_pct, addition_fee, removal_fee, minimum_cover_days, note, created_by)
    values (p.id, p.insurer_id, p_effective_from, coalesce(p_commission_pct, 0), coalesce(p_addition_fee, 0), coalesce(p_removal_fee, 0),
            coalesce(p_minimum_days, 0), nullif(btrim(coalesce(p_note, '')), ''), v_user) returning id into v_id;
  exception
    when unique_violation then raise exception 'terms already start on that date; choose a later date' using errcode = '23505';
    when check_violation then raise exception 'check the figures: commission is 0 to 100, fees cannot be negative, minimum days 0 to 366' using errcode = '22023';
  end;
  -- Audited under the insurer, so the fleet never sees commission or fees.
  perform private.write_audit(p.insurer_id, 'policy_terms.set', 'policy', p.id, null,
    jsonb_build_object('effective_from', p_effective_from, 'commission_pct', coalesce(p_commission_pct, 0), 'addition_fee', coalesce(p_addition_fee, 0),
                       'removal_fee', coalesce(p_removal_fee, 0), 'minimum_cover_days', coalesce(p_minimum_days, 0)));
  return v_id;
end $$;

-- Lines for the statement: one row per vehicle and rate segment. Shared by the saved statement and the bordereau so they always agree.
alter table public.reconciliation_lines add column min_days_added int not null default 0;

create function private.billing_lines(p_fleet uuid, p_policy uuid, p_ms date, p_start_charged boolean, p_end_charged boolean, p_tz text, p_dp int)
returns table (vehicle_id uuid, registration text, policy_id uuid, coverage_period_id uuid, first_d date, last_d date, days int, rate numeric, charge numeric, min_days_added int)
language sql stable set search_path = '' as $$
  with m as (select p_ms as ms, ((p_ms + interval '1 month')::date - 1) as me),
  periods as (
    select cp.id, cp.vehicle_id, v.registration, cp.policy_id, cp.cover_start, cp.cover_end,
      (cp.cover_start at time zone p_tz)::date + case when p_start_charged then 0 else 1 end as charge_first,
      coalesce((select t.minimum_cover_days from public.policy_terms t
                 where t.policy_id = cp.policy_id and t.effective_from <= (cp.cover_start at time zone p_tz)::date
                 order by t.effective_from desc limit 1), 0) as min_days,
      case when cp.cover_end is null then null
           when p_end_charged then ((cp.cover_end - interval '1 microsecond') at time zone p_tz)::date
           else (cp.cover_end at time zone p_tz)::date - 1 end as natural_last
    from public.coverage_periods cp
    join public.vehicles v on v.id = cp.vehicle_id
    where cp.fleet_id = p_fleet and cp.voided_at is null and (p_policy is null or cp.policy_id = p_policy)
  ), bounds as (
    select p.*,
      case when p.natural_last is null then null
           else greatest(p.natural_last, p.charge_first + p.min_days - 1) end as eff_last
    from periods p
  ), days as (
    select distinct on (b.vehicle_id, g::date) b.id, b.vehicle_id, b.registration, b.policy_id, g::date as day,
           (b.natural_last is not null and g::date > b.natural_last) as is_extra
    from bounds b, m
    cross join lateral generate_series(greatest(m.ms, b.charge_first)::timestamp, least(m.me, coalesce(b.eff_last, m.me))::timestamp, interval '1 day') g
    where greatest(m.ms, b.charge_first) <= least(m.me, coalesce(b.eff_last, m.me))
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
  select vehicle_id, registration, policy_id, id, min(day), max(day), count(*)::int, rate, round(count(*) * rate, p_dp),
         (count(*) filter (where is_extra))::int
  from rated
  group by id, vehicle_id, registration, policy_id, seg, rate
$$;

-- The statement now uses the shared lines (so the minimum cover period is billed) and records how many days came from the minimum.
create or replace function public.generate_reconciliation(p_fleet_id uuid, p_month date, p_policy_id uuid default null)
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
     first_charged_date, last_charged_date, days, daily_rate, charge, min_days_added)
  select v_id, p_fleet_id, l.vehicle_id, l.registration, l.policy_id, l.coverage_period_id, l.first_d, l.last_d, l.days, l.rate, l.charge, l.min_days_added
    from private.billing_lines(p_fleet_id, p_policy_id, v_ms, v_start_charged, v_end_charged, v_tz, v_dp) l;

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

-- The insurer's monthly bordereau: one row per policy, calculated live from the register with the same rules as the statements.
create function public.insurer_bordereau(p_insurer uuid, p_month date)
returns table (
  policy_id uuid, policy_number text, fleet_id uuid, fleet_name text,
  vehicles int, additions int, removals int, vehicle_days int, minimum_period_days int,
  premium_net numeric, ipt numeric, premium_gross numeric,
  commission_pct numeric, commission numeric, addition_fee numeric, removal_fee numeric, admin_fees numeric, remuneration numeric,
  terms_set boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ms date := date_trunc('month', p_month)::date;
  v_rules public.billing_rules;
  v_start boolean := true; v_end boolean := true; v_tz text := 'Europe/London'; v_dp int := 2; v_vat numeric := 0;
  v_ms_ts timestamptz; v_next_ts timestamptz;
  p record; t public.policy_terms;
  n_veh int; n_days int; n_min int; n_net numeric; n_add int; n_rem int; n_ipt numeric; n_comm numeric; n_fees numeric;
begin
  perform private.require_user();
  if p_insurer is null or not private.has_permission(p_insurer, 'reconciliation.read') or not private.has_permission(p_insurer, 'rates.read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisations o where o.id = p_insurer and o.kind = 'insurer') then
    raise exception 'insurer not found' using errcode = '22023';
  end if;
  select * into v_rules from public.billing_rules where insurer_id = p_insurer and effective_from <= v_ms order by effective_from desc limit 1;
  if found then
    v_start := v_rules.start_day_charged; v_end := v_rules.end_day_charged; v_tz := v_rules.timezone; v_dp := v_rules.rounding_dp; v_vat := v_rules.vat_rate;
  end if;
  if v_ms > (now() at time zone v_tz)::date then raise exception 'cannot report a month that has not started' using errcode = '22023'; end if;
  v_ms_ts := v_ms::timestamp at time zone v_tz;
  v_next_ts := ((v_ms + interval '1 month')::date)::timestamp at time zone v_tz;

  for p in select pol.id, pol.policy_number, pol.fleet_id, o.name as fleet_name from public.policies pol
             join public.organisations o on o.id = pol.fleet_id where pol.insurer_id = p_insurer order by o.name, pol.policy_number loop
    select count(distinct l.vehicle_id)::int, coalesce(sum(l.days), 0)::int, coalesce(sum(l.min_days_added), 0)::int, coalesce(sum(l.charge), 0)
      into n_veh, n_days, n_min, n_net
      from private.billing_lines(p.fleet_id, p.id, v_ms, v_start, v_end, v_tz, v_dp) l;
    continue when n_veh = 0;
    select count(*)::int into n_add from public.coverage_periods cp
      where cp.policy_id = p.id and cp.voided_at is null and cp.cover_start >= v_ms_ts and cp.cover_start < v_next_ts;
    select count(*)::int into n_rem from public.coverage_periods cp
      where cp.policy_id = p.id and cp.voided_at is null and cp.cover_end >= v_ms_ts and cp.cover_end < v_next_ts;
    select * into t from public.policy_terms pt where pt.policy_id = p.id and pt.effective_from <= v_ms order by pt.effective_from desc limit 1;
    n_ipt := round(n_net * v_vat, 2);
    n_comm := round(n_net * coalesce(t.commission_pct, 0) / 100, 2);
    n_fees := round(n_add * coalesce(t.addition_fee, 0) + n_rem * coalesce(t.removal_fee, 0), 2);
    policy_id := p.id; policy_number := p.policy_number; fleet_id := p.fleet_id; fleet_name := p.fleet_name;
    vehicles := n_veh; additions := n_add; removals := n_rem; vehicle_days := n_days; minimum_period_days := n_min;
    premium_net := n_net; ipt := n_ipt; premium_gross := n_net + n_ipt;
    commission_pct := coalesce(t.commission_pct, 0); commission := n_comm;
    addition_fee := coalesce(t.addition_fee, 0); removal_fee := coalesce(t.removal_fee, 0); admin_fees := n_fees; remuneration := n_comm + n_fees;
    terms_set := t.id is not null;
    return next;
  end loop;
end $$;

revoke all on function public.set_policy_terms(uuid, date, numeric, numeric, numeric, int, text), public.insurer_bordereau(uuid, date) from public, anon;
grant execute on function public.set_policy_terms(uuid, date, numeric, numeric, numeric, int, text), public.insurer_bordereau(uuid, date) to authenticated;
revoke all on function private.billing_lines(uuid, uuid, date, boolean, boolean, text, int) from public, anon, authenticated;
