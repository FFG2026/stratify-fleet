-- Two overlapping assignments for the same person are still one driver. Only a different person at the same time leaves the driver unknown.
create or replace function private.telematics_driver(p_vehicle uuid, p_at timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when count(distinct user_id) = 1 then (array_agg(user_id))[1] end
  from public.vehicle_assignments
  where vehicle_id = p_vehicle and assigned_from <= (p_at at time zone 'Europe/London')::date
    and (assigned_to is null or assigned_to >= (p_at at time zone 'Europe/London')::date)
$$;
