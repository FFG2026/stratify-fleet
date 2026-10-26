-- Telematics: provider-agnostic driving-behaviour records for a fleet's vehicles.
-- No telematics provider is connected. Records arrive by CSV upload (one press, validated in the database) and later by provider feeds
-- that call the same import function. Nothing here is sent to an insurer automatically.
-- Visibility: fleet admins and managers (and the platform) read the raw records, which name the driver.
-- Insurers read vehicle-level totals only, through telematics_vehicle_totals(), so a driver is never named to the insurer from this data.

insert into public.permissions (code, description) values
  ('telematics.read',   'Read vehicle-level telematics totals'),
  ('telematics.manage', 'Read driver-level telematics records and import telematics data')
on conflict (code) do nothing;
insert into public.role_permissions (role, permission) values
  ('platform_super_admin', 'telematics.read'), ('platform_super_admin', 'telematics.manage'),
  ('fleet_admin', 'telematics.read'), ('fleet_admin', 'telematics.manage'),
  ('fleet_manager', 'telematics.read'), ('fleet_manager', 'telematics.manage'),
  ('insurer_admin', 'telematics.read'), ('insurer_claims', 'telematics.read')
on conflict do nothing;

create table public.telematics_events (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.organisations (id),
  vehicle_id  uuid not null,
  driver_id   uuid references auth.users (id),
  occurred_at timestamptz not null,
  kind        text not null check (kind in ('harsh_braking', 'harsh_acceleration', 'harsh_cornering', 'speeding', 'crash_alert')),
  severity    smallint not null default 1 check (severity between 1 and 3),
  speed_mph   numeric(5,1) check (speed_mph is null or speed_mph between 0 and 250),
  limit_mph   numeric(5,1) check (limit_mph is null or limit_mph between 0 and 150),
  location    text check (location is null or char_length(location) <= 200),
  source      text not null default 'csv' check (char_length(source) between 1 and 60),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  foreign key (vehicle_id, fleet_id) references public.vehicles (id, fleet_id),
  unique (fleet_id, vehicle_id, occurred_at, kind)
);
create index telematics_events_fleet_time_idx on public.telematics_events (fleet_id, occurred_at desc);
create index telematics_events_vehicle_idx on public.telematics_events (vehicle_id, occurred_at desc);

create table public.telematics_trips (
  id             uuid primary key default gen_random_uuid(),
  fleet_id       uuid not null references public.organisations (id),
  vehicle_id     uuid not null,
  driver_id      uuid references auth.users (id),
  started_at     timestamptz not null,
  distance_miles numeric(7,1) not null check (distance_miles > 0 and distance_miles <= 3000),
  source         text not null default 'csv' check (char_length(source) between 1 and 60),
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  foreign key (vehicle_id, fleet_id) references public.vehicles (id, fleet_id),
  unique (fleet_id, vehicle_id, started_at)
);
create index telematics_trips_fleet_time_idx on public.telematics_trips (fleet_id, started_at desc);

alter table public.telematics_events enable row level security;
alter table public.telematics_trips enable row level security;
create policy telematics_events_read on public.telematics_events for select to authenticated
  using (fleet_id in (select private.accessible_orgs('telematics.manage')));
create policy telematics_trips_read on public.telematics_trips for select to authenticated
  using (fleet_id in (select private.accessible_orgs('telematics.manage')));
revoke all on public.telematics_events, public.telematics_trips from anon;
revoke insert, update, delete, truncate on public.telematics_events, public.telematics_trips from authenticated;

-- Who was driving: the person the vehicle was assigned to at that moment, if exactly one.
create function private.telematics_driver(p_vehicle uuid, p_at timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then (array_agg(user_id))[1] end
  from public.vehicle_assignments
  where vehicle_id = p_vehicle and assigned_from <= (p_at at time zone 'Europe/London')::date
    and (assigned_to is null or assigned_to >= (p_at at time zone 'Europe/London')::date)
$$;

-- Import rows. Each element: {"type":"event"|"trip","registration":"AB12CDE","at":"2026-10-20T08:30:00Z",
--   "kind":"speeding","severity":2,"speed_mph":55,"limit_mph":40,"location":"A1","distance_miles":12.4}
-- Whole batch or nothing: any bad row rejects the import with the row number. Duplicates are skipped, not errors.
create function public.import_telematics(p_fleet uuid, p_rows jsonb, p_source text default 'csv') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); r jsonb; i int := 0; v_veh uuid; v_at timestamptz; v_reg text; v_kind text;
  v_events int := 0; v_trips int := 0; v_dupes int := 0; v_crash int := 0; v_n int; v_source text := left(btrim(coalesce(p_source, 'csv')), 60);
begin
  if not private.has_permission(p_fleet, 'telematics.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'no rows to import' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'at most 2000 rows per import' using errcode = '22023'; end if;
  if v_source = '' then v_source := 'csv'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_reg := upper(regexp_replace(coalesce(r ->> 'registration', ''), '\s', '', 'g'));
      select id into v_veh from public.vehicles where fleet_id = p_fleet and registration = v_reg;
      if v_veh is null then raise exception 'vehicle % is not on this fleet', v_reg using errcode = '22023'; end if;
      v_at := (r ->> 'at')::timestamptz;
      if v_at > now() + interval '1 hour' or v_at < now() - interval '2 years' then raise exception 'date out of range' using errcode = '22023'; end if;
      if r ->> 'type' = 'trip' then
        insert into public.telematics_trips (fleet_id, vehicle_id, driver_id, started_at, distance_miles, source, created_by)
        values (p_fleet, v_veh, private.telematics_driver(v_veh, v_at), v_at, (r ->> 'distance_miles')::numeric, v_source, v_user)
        on conflict (fleet_id, vehicle_id, started_at) do nothing;
        get diagnostics v_n = row_count; v_trips := v_trips + v_n; v_dupes := v_dupes + (1 - v_n);
      elsif r ->> 'type' = 'event' then
        v_kind := r ->> 'kind';
        insert into public.telematics_events (fleet_id, vehicle_id, driver_id, occurred_at, kind, severity, speed_mph, limit_mph, location, source, created_by)
        values (p_fleet, v_veh, private.telematics_driver(v_veh, v_at), v_at, v_kind, coalesce((r ->> 'severity')::smallint, 1),
                nullif(r ->> 'speed_mph', '')::numeric, nullif(r ->> 'limit_mph', '')::numeric, nullif(left(btrim(r ->> 'location'), 200), ''), v_source, v_user)
        on conflict (fleet_id, vehicle_id, occurred_at, kind) do nothing;
        get diagnostics v_n = row_count; v_events := v_events + v_n; v_dupes := v_dupes + (1 - v_n);
        if v_n = 1 and v_kind = 'crash_alert' then
          v_crash := v_crash + 1;
          perform private.notify(p_fleet, 'telematics.manage', null, null, 'telematics_crash', 'Crash alert for ' || v_reg,
            'A crash alert was imported for ' || v_reg || ' at ' || to_char(v_at at time zone 'Europe/London', 'DD/MM/YYYY HH24:MI') || '. Check on the driver and report a claim if needed.');
        end if;
      else
        raise exception 'type must be event or trip' using errcode = '22023';
      end if;
    exception when others then
      raise exception 'row %: %', i, case when sqlstate in ('22P02', '22007', '22008', '23514', '22003') then 'a value is not valid' else sqlerrm end using errcode = '22023';
    end;
  end loop;
  perform private.write_audit(p_fleet, 'telematics.imported', 'organisation', p_fleet, null,
    jsonb_build_object('source', v_source, 'events', v_events, 'trips', v_trips, 'duplicates', v_dupes, 'crash_alerts', v_crash));
  return jsonb_build_object('events', v_events, 'trips', v_trips, 'duplicates', v_dupes, 'crash_alerts', v_crash);
end $$;

-- Vehicle-level totals for the last p_days days. Safe for insurers: no driver, no location, no times.
create function public.telematics_vehicle_totals(p_fleet uuid, p_days int default 90) returns table (
  registration text, miles numeric, harsh_braking bigint, harsh_acceleration bigint, harsh_cornering bigint, speeding bigint, crash_alerts bigint,
  weighted_points bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)));
begin
  perform private.require_user();
  if not private.has_permission(p_fleet, 'telematics.read') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select v.registration,
    coalesce((select sum(t.distance_miles) from public.telematics_trips t where t.vehicle_id = v.id and t.started_at >= v_since), 0),
    count(e.id) filter (where e.kind = 'harsh_braking'), count(e.id) filter (where e.kind = 'harsh_acceleration'),
    count(e.id) filter (where e.kind = 'harsh_cornering'), count(e.id) filter (where e.kind = 'speeding'),
    count(e.id) filter (where e.kind = 'crash_alert'),
    coalesce(sum(e.severity * case e.kind when 'speeding' then 2 when 'crash_alert' then 0 else 1 end), 0)::bigint
  from public.vehicles v
  left join public.telematics_events e on e.vehicle_id = v.id and e.occurred_at >= v_since
  where v.fleet_id = p_fleet
  group by v.id, v.registration
  having count(e.id) > 0 or exists (select 1 from public.telematics_trips t where t.vehicle_id = v.id and t.started_at >= v_since)
  order by v.registration;
end $$;

revoke all on function public.import_telematics(uuid, jsonb, text), public.telematics_vehicle_totals(uuid, int),
  private.telematics_driver(uuid, timestamptz) from public, anon;
grant execute on function public.import_telematics(uuid, jsonb, text), public.telematics_vehicle_totals(uuid, int) to authenticated;
