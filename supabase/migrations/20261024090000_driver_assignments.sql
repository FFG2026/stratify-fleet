-- Drivers see only the vehicles they are assigned to, and the cover on those vehicles.
-- Assignments are made by people who can put vehicles on cover; drivers cannot see the rest of the fleet.
create table public.vehicle_assignments (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null references public.organisations(id),
  vehicle_id    uuid not null references public.vehicles(id),
  user_id       uuid not null references auth.users(id),
  assigned_from date not null,
  assigned_to   date,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (assigned_to is null or assigned_to >= assigned_from)
);
create index vehicle_assignments_user_idx on public.vehicle_assignments (user_id);
create index vehicle_assignments_vehicle_idx on public.vehicle_assignments (vehicle_id);
alter table public.vehicle_assignments enable row level security;
create policy vehicle_assignments_read on public.vehicle_assignments for select to authenticated
  using (user_id = (select auth.uid()) or fleet_id in (select private.accessible_orgs('coverage.read')));
revoke insert, update, delete, truncate on public.vehicle_assignments from anon, authenticated;

create function public.assign_driver(p_vehicle uuid, p_user uuid, p_from date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_fleet uuid; v_id uuid;
begin
  perform private.require_user();
  select fleet_id into v_fleet from public.vehicles where id = p_vehicle;
  if v_fleet is null or not private.has_permission(v_fleet, 'coverage.add') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null then raise exception 'choose the date the driver takes the vehicle' using errcode = '22023'; end if;
  if not exists (select 1 from public.memberships m where m.user_id = p_user and m.organisation_id = v_fleet and m.role = 'driver' and m.active) then
    raise exception 'that person is not an active driver in this fleet' using errcode = '22023';
  end if;
  if exists (select 1 from public.vehicle_assignments a where a.vehicle_id = p_vehicle and a.user_id = p_user
             and (a.assigned_to is null or a.assigned_to >= p_from)) then
    raise exception 'that driver already has this vehicle for those dates' using errcode = '23505';
  end if;
  insert into public.vehicle_assignments (fleet_id, vehicle_id, user_id, assigned_from, created_by)
  values (v_fleet, p_vehicle, p_user, p_from, (select auth.uid())) returning id into v_id;
  perform private.write_audit(v_fleet, 'driver.assigned', 'vehicle_assignment', v_id, null,
    jsonb_build_object('vehicle_id', p_vehicle, 'user_id', p_user, 'assigned_from', p_from));
  return v_id;
end $$;

create function public.end_assignment(p_assignment uuid, p_to date) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.vehicle_assignments;
begin
  perform private.require_user();
  select * into a from public.vehicle_assignments where id = p_assignment for update;
  if not found or not private.has_permission(a.fleet_id, 'coverage.add') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if a.assigned_to is not null then raise exception 'that assignment has already ended' using errcode = '22023'; end if;
  if p_to is null or p_to < a.assigned_from then raise exception 'the end date cannot be before the start date' using errcode = '22023'; end if;
  update public.vehicle_assignments set assigned_to = p_to where id = a.id;
  perform private.write_audit(a.fleet_id, 'driver.unassigned', 'vehicle_assignment', a.id,
    jsonb_build_object('assigned_to', null), jsonb_build_object('assigned_to', p_to));
end $$;

-- What the signed-in driver can see: their own assignments and the cover periods that overlap them. Nothing else about the fleet.
create function public.my_cover() returns table (
  assignment_id uuid, vehicle_id uuid, registration text, make_model text,
  assigned_from date, assigned_to date, cover_start timestamptz, cover_end timestamptz
) language sql stable security definer set search_path = '' as $$
  select a.id, v.id, v.registration, v.make_model, a.assigned_from, a.assigned_to, c.cover_start, c.cover_end
    from public.vehicle_assignments a
    join public.vehicles v on v.id = a.vehicle_id
    left join public.coverage_periods c
      on c.vehicle_id = a.vehicle_id and c.voided_at is null
     and c.cover_start < (coalesce(a.assigned_to, 'infinity'::date) + 1)::timestamptz
     and (c.cover_end is null or c.cover_end > a.assigned_from::timestamptz)
   where a.user_id = (select auth.uid())
   order by a.assigned_from desc, c.cover_start desc
$$;

revoke all on function public.assign_driver(uuid, uuid, date), public.end_assignment(uuid, date), public.my_cover() from public, anon;
grant execute on function public.assign_driver(uuid, uuid, date), public.end_assignment(uuid, date), public.my_cover() to authenticated;
