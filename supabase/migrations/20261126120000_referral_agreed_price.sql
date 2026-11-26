-- A vehicle authorised outside the policy's normal criteria can carry its own agreed daily rate, set by the insurer when they authorise it.
-- Where there is one, the statements and the bordereau charge that rate for that vehicle's cover period instead of the policy's rate card.

alter table public.cover_referrals add column agreed_daily_rate numeric(12,4) check (agreed_daily_rate is null or agreed_daily_rate >= 0);

-- Same as before, except a period created from an authorisation with an agreed rate uses that rate.
create or replace function private.billing_lines(p_fleet uuid, p_policy uuid, p_ms date, p_start_charged boolean, p_end_charged boolean, p_tz text, p_dp int)
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
    select d.*, r.effective_from as seg, coalesce(ov.agreed_daily_rate, r.daily_rate, private.missing_rate(d.policy_id, d.day)) as rate
    from days d
    left join lateral (
      select rc.effective_from, rc.daily_rate from public.rate_cards rc
      where rc.policy_id = d.policy_id and rc.effective_from <= d.day
      order by rc.effective_from desc limit 1
    ) r on true
    left join lateral (
      select x.agreed_daily_rate from public.cover_referrals x
      where x.period_id = d.id and x.status = 'approved' and x.agreed_daily_rate is not null limit 1
    ) ov on true
  )
  select vehicle_id, registration, policy_id, id, min(day), max(day), count(*)::int, rate, round(count(*) * rate, p_dp),
         (count(*) filter (where is_extra))::int
  from rated
  group by id, vehicle_id, registration, policy_id, seg, rate
$$;

-- The decision now accepts an optional agreed daily rate, used only when authorising. Calls that leave it out behave exactly as before.
drop function public.decide_cover_referral(uuid, text, text, timestamptz);
create function public.decide_cover_referral(p_referral uuid, p_decision text, p_message text default null, p_effective_at timestamptz default null, p_daily_rate numeric default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); r public.cover_referrals; v_eff timestamptz; v_period uuid; v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_rate numeric := case when p_decision = 'approve' then p_daily_rate end;
begin
  select * into r from public.cover_referrals where id = p_referral for update;
  if not found or not private.has_permission(r.insurer_id, 'referrals.decide') then raise exception 'permission denied' using errcode = '42501'; end if;
  if r.status not in ('awaiting_authorisation', 'queried') then raise exception 'this request is already %', replace(r.status, '_', ' ') using errcode = '22023'; end if;
  if p_decision not in ('approve', 'query', 'decline') then raise exception 'choose approve, query or decline' using errcode = '22023'; end if;
  if p_decision in ('query', 'decline') and v_msg is null then raise exception 'write a message for the customer' using errcode = '22023'; end if;
  if v_rate is not null and (v_rate < 0 or v_rate > 10000) then raise exception 'check the daily rate' using errcode = '22023'; end if;

  if p_decision = 'approve' then
    v_eff := coalesce(p_effective_at, greatest(r.requested_effective_at, now()));
    perform set_config('stratify.cover_ok', 'on', true);
    v_period := public.add_vehicle_cover(r.fleet_id, r.policy_id, r.registration, v_eff, r.make_model, 'Authorised by the insurer');
    perform set_config('stratify.cover_ok', 'off', true);
    update public.cover_referrals set status = 'approved', decided_at = now(), decided_by = v_user, updated_at = now(), period_id = v_period,
           agreed_daily_rate = round(v_rate, 4) where id = r.id;
  elsif p_decision = 'query' then
    update public.cover_referrals set status = 'queried', updated_at = now() where id = r.id;
  else
    update public.cover_referrals set status = 'declined', decided_at = now(), decided_by = v_user, updated_at = now() where id = r.id;
  end if;
  if v_msg is not null then
    insert into public.cover_referral_messages (referral_id, fleet_id, side, author_id, body) values (r.id, r.fleet_id, 'insurer', v_user, v_msg);
  end if;
  perform private.write_audit(r.fleet_id, 'cover.referral_' || case p_decision when 'approve' then 'approved' when 'query' then 'queried' else 'declined' end,
    'cover_referral', r.id, jsonb_build_object('status', r.status),
    jsonb_build_object('registration', r.registration, 'decision', p_decision, 'agreed_daily_rate', round(v_rate, 4)), v_msg);
  return case p_decision when 'approve' then 'approved' when 'query' then 'queried' else 'declined' end;
end $$;
revoke all on function public.decide_cover_referral(uuid, text, text, timestamptz, numeric) from public, anon;
grant execute on function public.decide_cover_referral(uuid, text, text, timestamptz, numeric) to authenticated;
