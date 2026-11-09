-- Per-vehicle movement lines for the bordereau, and the vehicles still awaiting authorisation (not in any total).

create function public.insurer_bordereau_lines(p_insurer uuid, p_month date)
returns table (
  policy_id uuid, policy_number text, fleet_name text, registration text, make_model text,
  added_on date, removed_on date, status text, days int, minimum_days int,
  premium_net numeric, ipt numeric, premium_gross numeric, commission numeric, net_to_insurer numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ms date := date_trunc('month', p_month)::date;
  v_rules public.billing_rules;
  v_start boolean := true; v_end boolean := true; v_tz text := 'Europe/London'; v_dp int := 2; v_vat numeric := 0;
  v_ms_ts timestamptz; v_next_ts timestamptz; p record; t public.policy_terms;
begin
  perform private.require_user();
  if p_insurer is null or not private.has_permission(p_insurer, 'reconciliation.read') or not private.has_permission(p_insurer, 'rates.read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_rules from public.billing_rules where insurer_id = p_insurer and effective_from <= v_ms order by effective_from desc limit 1;
  if found then v_start := v_rules.start_day_charged; v_end := v_rules.end_day_charged; v_tz := v_rules.timezone; v_dp := v_rules.rounding_dp; v_vat := v_rules.vat_rate; end if;
  if v_ms > (now() at time zone v_tz)::date then raise exception 'cannot report a month that has not started' using errcode = '22023'; end if;
  v_ms_ts := v_ms::timestamp at time zone v_tz;
  v_next_ts := ((v_ms + interval '1 month')::date)::timestamp at time zone v_tz;

  for p in select pol.id, pol.policy_number, pol.fleet_id, o.name as fleet_name from public.policies pol
             join public.organisations o on o.id = pol.fleet_id where pol.insurer_id = p_insurer order by o.name, pol.policy_number loop
    select * into t from public.policy_terms pt where pt.policy_id = p.id and pt.effective_from <= v_ms order by pt.effective_from desc limit 1;
    return query
      with bl as (select l.coverage_period_id, sum(l.days)::int as d, sum(l.min_days_added)::int as md, sum(l.charge) as net
                    from private.billing_lines(p.fleet_id, p.id, v_ms, v_start, v_end, v_tz, v_dp) l group by l.coverage_period_id)
      select p.id, p.policy_number, p.fleet_name, v.registration, v.make_model,
             case when cp.cover_start >= v_ms_ts and cp.cover_start < v_next_ts then (cp.cover_start at time zone v_tz)::date end,
             case when cp.cover_end >= v_ms_ts and cp.cover_end < v_next_ts then (cp.cover_end at time zone v_tz)::date end,
             case when exists (select 1 from public.cover_referrals r where r.period_id = cp.id) then 'Authorised' else 'Processed' end,
             coalesce(bl.d, 0), coalesce(bl.md, 0), coalesce(bl.net, 0),
             round(coalesce(bl.net, 0) * v_vat, 2), coalesce(bl.net, 0) + round(coalesce(bl.net, 0) * v_vat, 2),
             round(coalesce(bl.net, 0) * coalesce(t.commission_pct, 0) / 100, 2),
             coalesce(bl.net, 0) + round(coalesce(bl.net, 0) * v_vat, 2) - round(coalesce(bl.net, 0) * coalesce(t.commission_pct, 0) / 100, 2)
        from public.coverage_periods cp
        join public.vehicles v on v.id = cp.vehicle_id
        left join bl on bl.coverage_period_id = cp.id
       where cp.policy_id = p.id and cp.voided_at is null
         and ((cp.cover_start >= v_ms_ts and cp.cover_start < v_next_ts) or (cp.cover_end >= v_ms_ts and cp.cover_end < v_next_ts))
       order by coalesce((cp.cover_start at time zone v_tz)::date, v_ms), v.registration;
  end loop;
end $$;

create function public.insurer_pending_referrals(p_insurer uuid, p_month date)
returns table (
  id uuid, policy_number text, fleet_name text, registration text, make_model text, vehicle_type text,
  status text, requested_on date, estimated_net numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare v_ms date := date_trunc('month', p_month)::date; v_me date := (date_trunc('month', p_month) + interval '1 month')::date - 1;
begin
  perform private.require_user();
  if p_insurer is null or not private.has_permission(p_insurer, 'reconciliation.read') or not private.has_permission(p_insurer, 'rates.read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select r.id, pol.policy_number, o.name, r.registration, r.make_model, r.vehicle_type, r.status,
           (r.requested_effective_at at time zone 'Europe/London')::date,
           coalesce(round(greatest(0, v_me - greatest(v_ms, (r.requested_effective_at at time zone 'Europe/London')::date) + 1) *
             (select rc.daily_rate from public.rate_cards rc where rc.policy_id = r.policy_id and rc.effective_from <= v_me order by rc.effective_from desc limit 1), 2), 0)
      from public.cover_referrals r
      join public.policies pol on pol.id = r.policy_id
      join public.organisations o on o.id = r.fleet_id
     where r.insurer_id = p_insurer and r.status in ('awaiting_authorisation', 'queried')
       and (r.requested_effective_at at time zone 'Europe/London')::date <= v_me
     order by r.created_at;
end $$;

revoke all on function public.insurer_bordereau_lines(uuid, date), public.insurer_pending_referrals(uuid, date) from public, anon;
grant execute on function public.insurer_bordereau_lines(uuid, date), public.insurer_pending_referrals(uuid, date) to authenticated;
