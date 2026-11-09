-- Claim costs (insurer only), burn rate per fleet policy, and the monthly price per vehicle shown to insurer and customer.
-- Burn rate = incurred claims (paid + reserve) divided by earned net premium (before IPT), as a percentage.
-- Monthly price per vehicle = daily rate x 365 / 12.

create table public.claim_costs (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims (id),
  fleet_id    uuid not null references public.organisations (id),
  insurer_id  uuid not null references public.organisations (id),
  paid        numeric(12,2) not null default 0 check (paid >= 0),
  reserve     numeric(12,2) not null default 0 check (reserve >= 0),
  note        text check (note is null or char_length(note) <= 500),
  recorded_by uuid,
  recorded_at timestamptz not null default clock_timestamp()
);
create index claim_costs_claim_idx on public.claim_costs (claim_id, recorded_at desc);
create trigger claim_costs_append_only before update or delete on public.claim_costs for each row execute function private.forbid_mutation();
alter table public.claim_costs enable row level security;
-- Insurer side only: the fleet has no claim.manage permission, so it never sees costs.
create policy claim_costs_read on public.claim_costs for select to authenticated
  using (fleet_id in (select private.accessible_orgs('claim.manage')));
revoke all on public.claim_costs from anon;
revoke insert, update, delete, truncate on public.claim_costs from authenticated;
grant select on public.claim_costs to authenticated;

create function public.set_claim_cost(p_claim uuid, p_paid numeric, p_reserve numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); c public.claims; v_id uuid;
begin
  c := private.insurer_claim(p_claim);
  if p_paid is null or p_reserve is null or p_paid < 0 or p_reserve < 0 then raise exception 'enter paid and reserve as amounts of 0 or more' using errcode = '22023'; end if;
  insert into public.claim_costs (claim_id, fleet_id, insurer_id, paid, reserve, note, recorded_by)
  values (c.id, c.fleet_id, c.insurer_id, round(p_paid, 2), round(p_reserve, 2), nullif(btrim(coalesce(p_note, '')), ''), v_user) returning id into v_id;
  perform private.write_audit(c.insurer_id, 'claim.cost_set', 'claim', c.id, null, jsonb_build_object('paid', round(p_paid, 2), 'reserve', round(p_reserve, 2)), p_note);
  return v_id;
end $$;

-- Net premium for one policy in one month, using the insurer's rules for that month.
create function private.month_net(p_insurer uuid, p_fleet uuid, p_policy uuid, p_ms date) returns numeric
language plpgsql stable set search_path = '' as $$
declare v_rules public.billing_rules; v_start boolean := true; v_end boolean := true; v_tz text := 'Europe/London'; v_dp int := 2;
begin
  select * into v_rules from public.billing_rules where insurer_id = p_insurer and effective_from <= p_ms order by effective_from desc limit 1;
  if found then v_start := v_rules.start_day_charged; v_end := v_rules.end_day_charged; v_tz := v_rules.timezone; v_dp := v_rules.rounding_dp; end if;
  return coalesce((select sum(l.charge) from private.billing_lines(p_fleet, p_policy, p_ms, v_start, v_end, v_tz, v_dp) l), 0);
end $$;
revoke all on function private.month_net(uuid, uuid, uuid, date) from public, anon, authenticated;

create function public.insurer_burn_rate(p_insurer uuid)
returns table (
  policy_id uuid, policy_number text, fleet_id uuid, fleet_name text, period_from date, vehicles int,
  daily_rate numeric, monthly_price numeric, earned_net numeric, claims int, paid numeric, reserve numeric, incurred numeric, burn_rate_pct numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_this date := date_trunc('month', now() at time zone 'Europe/London')::date;
  p record; m date; v_from date; v_earned numeric; v_rate numeric; n_claims int; n_paid numeric; n_res numeric; n_veh int;
begin
  perform private.require_user();
  if p_insurer is null or not private.has_permission(p_insurer, 'rates.read') or not private.has_permission(p_insurer, 'claim.read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  for p in select pol.id, pol.policy_number, pol.fleet_id, o.name as fleet_name, pol.valid_from from public.policies pol
             join public.organisations o on o.id = pol.fleet_id where pol.insurer_id = p_insurer order by o.name, pol.policy_number loop
    v_from := greatest(p.valid_from, (v_this - interval '11 months')::date);
    v_earned := 0; m := date_trunc('month', v_from)::date;
    while m <= v_this loop v_earned := v_earned + private.month_net(p_insurer, p.fleet_id, p.id, m); m := (m + interval '1 month')::date; end loop;
    select rc.daily_rate into v_rate from public.rate_cards rc where rc.policy_id = p.id and rc.effective_from <= v_today order by rc.effective_from desc limit 1;
    select count(distinct v.id)::int into n_veh from public.coverage_periods cp join public.vehicles v on v.id = cp.vehicle_id
      where cp.policy_id = p.id and cp.voided_at is null and cp.cover_start <= now() and (cp.cover_end is null or cp.cover_end > now());
    select count(*)::int, coalesce(sum(lc.paid), 0), coalesce(sum(lc.reserve), 0) into n_claims, n_paid, n_res
      from public.claims c left join lateral (select cc.paid, cc.reserve from public.claim_costs cc where cc.claim_id = c.id order by cc.recorded_at desc limit 1) lc on true
     where c.policy_id = p.id and c.status <> 'reported' and (c.incident_at at time zone 'Europe/London')::date >= v_from;
    continue when v_earned = 0 and n_claims = 0 and n_veh = 0;
    policy_id := p.id; policy_number := p.policy_number; fleet_id := p.fleet_id; fleet_name := p.fleet_name; period_from := v_from; vehicles := n_veh;
    daily_rate := v_rate; monthly_price := round(v_rate * 365 / 12, 2); earned_net := v_earned; claims := n_claims; paid := n_paid; reserve := n_res; incurred := n_paid + n_res;
    burn_rate_pct := case when v_earned > 0 then round((n_paid + n_res) / v_earned * 100, 1) end;
    return next;
  end loop;
end $$;

-- What the customer pays per vehicle, from the same rate the statements use.
create function public.fleet_policy_prices(p_fleet uuid)
returns table (policy_id uuid, policy_number text, daily_rate numeric, monthly_price numeric, effective_from date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if p_fleet is null or not private.has_permission(p_fleet, 'reconciliation.read') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
    select pol.id, pol.policy_number, rc.daily_rate, round(rc.daily_rate * 365 / 12, 2), rc.effective_from
      from public.policies pol
      join lateral (select r.daily_rate, r.effective_from from public.rate_cards r where r.policy_id = pol.id and r.effective_from <= (now() at time zone 'Europe/London')::date order by r.effective_from desc limit 1) rc on true
     where pol.fleet_id = p_fleet order by pol.policy_number;
end $$;

revoke all on function public.set_claim_cost(uuid, numeric, numeric, text), public.insurer_burn_rate(uuid), public.fleet_policy_prices(uuid) from public, anon;
grant execute on function public.set_claim_cost(uuid, numeric, numeric, text), public.insurer_burn_rate(uuid), public.fleet_policy_prices(uuid) to authenticated;
