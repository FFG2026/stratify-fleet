-- Insurer claims inbox: who owns a sent claim, and when it was first touched.
-- Not a claims-paying system. No reserves, payments or loss ratio. The fleet never sees assignment events.

-- Handling details live in their own table, readable by the insurer side only. They must NOT sit on public.claims:
-- fleet staff and the reporting driver can read that table, and would then see the handler's email and response times.
create table public.claim_handling (
  claim_id uuid primary key references public.claims (id) on delete cascade,
  handler_id uuid references auth.users (id),
  handler_email text check (handler_email is null or char_length(handler_email) <= 200),
  assigned_at timestamptz,
  first_touched_at timestamptz,
  check ((handler_id is null) = (handler_email is null) and (handler_id is null) = (assigned_at is null))
);
create index claim_handling_handler_idx on public.claim_handling (handler_id) where handler_id is not null;
alter table public.claim_handling enable row level security;
create policy claim_handling_read on public.claim_handling for select to authenticated
  using ('insurer' = any (private.claim_sides(claim_id)));
revoke all on public.claim_handling from anon;
revoke insert, update, delete, truncate on public.claim_handling from authenticated;
grant select on public.claim_handling to authenticated;

-- Auto-take an unassigned sent claim and stamp first touch. Used when the insurer starts work.
create function private.ensure_claim_touch(p_claim uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from auth.users where id = p_user;
  insert into public.claim_handling (claim_id, handler_id, handler_email, assigned_at, first_touched_at)
    values (p_claim, p_user, v_email, now(), now())
  on conflict (claim_id) do update set
    handler_id = coalesce(public.claim_handling.handler_id, excluded.handler_id),
    handler_email = case when public.claim_handling.handler_id is null then excluded.handler_email else public.claim_handling.handler_email end,
    assigned_at = case when public.claim_handling.handler_id is null then now() else public.claim_handling.assigned_at end,
    first_touched_at = coalesce(public.claim_handling.first_touched_at, now());
  update public.claims set updated_at = now() where id = p_claim;
end $$;

create or replace function public.log_insurer_claim(
  p_fleet uuid, p_vehicle uuid, p_registration text, p_driver uuid, p_driver_name text, p_incident_at timestamptz, p_location text, p_description text,
  p_injured boolean, p_injury_details text, p_police boolean, p_police_ref text, p_insurer_ref text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_insurer uuid; v_id uuid; v_reg text; v_policy uuid; v_name text; v_driver uuid; v_email text; c public.claims;
begin
  if p_fleet is null or not private.has_permission(p_fleet, 'claim.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select insurer_id into v_insurer from public.organisations where id = p_fleet and kind = 'fleet';
  if v_insurer is null then raise exception 'fleet not found' using errcode = '22023'; end if;
  perform private.check_claim_fields(p_incident_at, p_location, p_description, p_injured, p_injury_details);
  if p_vehicle is not null then
    select registration into v_reg from public.vehicles where id = p_vehicle and fleet_id = p_fleet;
    if v_reg is null then raise exception 'that vehicle is not in this fleet' using errcode = '22023'; end if;
    v_policy := private.cover_at(p_vehicle, p_incident_at);
  else
    v_reg := private.normalise_registration(p_registration);
    if not private.is_valid_registration(v_reg) then raise exception 'check the registration' using errcode = '22023'; end if;
  end if;
  if p_driver is not null then
    if not exists (select 1 from public.memberships m where m.user_id = p_driver and m.organisation_id = p_fleet and m.role = 'driver' and m.active) then
      raise exception 'that person is not an active driver in this fleet' using errcode = '22023'; end if;
    v_driver := p_driver; v_name := (select full_name from public.driver_profiles where user_id = p_driver);
  end if;
  v_name := coalesce(v_name, nullif(btrim(coalesce(p_driver_name, '')), ''));
  select email into v_email from auth.users where id = v_user;
  insert into public.claims (reference, fleet_id, insurer_id, policy_id, vehicle_id, registration, driver_user_id, driver_name, origin, reported_by, status,
      incident_at, location, description, anyone_injured, injury_details, police_attended, police_reference, on_cover_at_incident, submitted_at, submitted_by, insurer_reference)
  values (private.next_claim_ref(), p_fleet, v_insurer, v_policy, p_vehicle, v_reg, v_driver, v_name, 'insurer', v_user, 'under_review',
      p_incident_at, btrim(p_location), btrim(p_description), p_injured, case when p_injured then btrim(p_injury_details) end, p_police,
      case when p_police then nullif(btrim(coalesce(p_police_ref, '')), '') end, case when p_vehicle is null then null else v_policy is not null end,
      now(), v_user, nullif(btrim(coalesce(p_insurer_ref, '')), ''))
  returning * into c;
  v_id := c.id;
  insert into public.claim_handling (claim_id, handler_id, handler_email, assigned_at, first_touched_at) values (v_id, v_user, v_email, now(), now());
  perform private.claim_event(c, 'logged_by_insurer', 'insurer', 'shared', 'Logged by the insurer.');
  perform private.notify(p_fleet, 'claim.submit', null, v_id, 'claim_logged', 'A claim has been logged by your insurer',
    c.reference || ' · ' || v_reg || ' · ' || to_char(p_incident_at at time zone 'Europe/London', 'DD/MM/YYYY') || '. Please check it and add anything you know.');
  if v_driver is not null then
    perform private.notify(null, null, v_driver, v_id, 'claim_logged', 'A claim has been logged against you', c.reference || ' · ' || v_reg);
  end if;
  perform private.write_audit(p_fleet, 'claim.logged_by_insurer', 'claim', v_id, null, jsonb_build_object('registration', v_reg, 'insurer', v_insurer));
  return v_id;
end $$;

create or replace function public.start_claim_review(p_claim uuid, p_insurer_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_user uuid := private.require_user(); v_ref text := nullif(btrim(coalesce(p_insurer_ref, '')), '');
begin
  if c.status = 'closed' then raise exception 'this claim is closed; reopen it first' using errcode = '22023'; end if;
  if c.status = 'submitted' then
    update public.claims set status = 'under_review', insurer_reference = coalesce(v_ref, insurer_reference), updated_at = now() where id = c.id;
    perform private.claim_event(c, 'status_changed', 'insurer', 'shared', 'The insurer is reviewing this claim.' || coalesce(' Insurer reference: ' || v_ref || '.', ''));
    perform private.notify(c.fleet_id, 'claim.read', null, c.id, 'claim_status', c.reference || ' is being reviewed by the insurer', coalesce('Insurer reference ' || v_ref, null));
  elsif v_ref is not null then
    update public.claims set insurer_reference = v_ref, updated_at = now() where id = c.id;
    perform private.claim_event(c, 'reference_set', 'insurer', 'shared', 'Insurer reference: ' || v_ref || '.');
  end if;
  perform private.ensure_claim_touch(c.id, v_user);
  perform private.write_audit(c.fleet_id, 'claim.review_started', 'claim', c.id, null, null);
end $$;

create or replace function public.request_claim_info(p_claim uuid, p_question text, p_due date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_id uuid; v_user uuid := private.require_user();
begin
  if c.status = 'closed' then raise exception 'this claim is closed; reopen it first' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_question, ''))) < 3 then raise exception 'write the question' using errcode = '22023'; end if;
  if p_due is not null and p_due < current_date then raise exception 'the due date is in the past' using errcode = '22023'; end if;
  insert into public.claim_requests (claim_id, fleet_id, question, due_on, requested_by) values (c.id, c.fleet_id, btrim(p_question), p_due, v_user) returning id into v_id;
  update public.claims set status = 'awaiting_information', updated_at = now() where id = c.id;
  perform private.claim_event(c, 'info_requested', 'insurer', 'shared', btrim(p_question));
  perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'info_requested', 'The insurer needs more information on ' || c.reference, left(btrim(p_question), 300));
  perform private.ensure_claim_touch(c.id, v_user);
  perform private.write_audit(c.fleet_id, 'claim.info_requested', 'claim', c.id, null, jsonb_build_object('request', v_id));
  return v_id;
end $$;

create function public.assign_claim_handler(p_claim uuid, p_handler uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.claims := private.insurer_claim(p_claim);
  v_user uuid := private.require_user();
  v_email text;
  v_ok boolean;
  v_old uuid;
begin
  select handler_id into v_old from public.claim_handling where claim_id = c.id;
  if c.status = 'closed' then raise exception 'this claim is closed; reopen it first' using errcode = '22023'; end if;
  if p_handler is null then
    update public.claim_handling set handler_id = null, handler_email = null, assigned_at = null where claim_id = c.id;
    update public.claims set updated_at = now() where id = c.id;
    perform private.claim_event(c, 'handler_assigned', 'insurer', 'insurer', 'Returned to the unassigned pile.');
    perform private.write_audit(c.fleet_id, 'claim.handler_cleared', 'claim', c.id, jsonb_build_object('handler_id', v_old), null);
    return;
  end if;
  select exists (
    select 1 from public.memberships m
    join public.role_permissions rp on rp.role = m.role and rp.permission = 'claim.manage'
    join public.organisations mo on mo.id = m.organisation_id
    where m.user_id = p_handler and m.active and (mo.id = c.insurer_id or mo.kind = 'platform')
  ) into v_ok;
  if not v_ok then raise exception 'that person cannot handle this claim' using errcode = '22023'; end if;
  select email into v_email from auth.users where id = p_handler;
  insert into public.claim_handling (claim_id, handler_id, handler_email, assigned_at, first_touched_at)
    values (c.id, p_handler, v_email, now(), case when p_handler = v_user then now() end)
  on conflict (claim_id) do update set
    handler_id = excluded.handler_id, handler_email = excluded.handler_email, assigned_at = now(),
    first_touched_at = case when p_handler = v_user then coalesce(public.claim_handling.first_touched_at, now()) else public.claim_handling.first_touched_at end;
  update public.claims set updated_at = now() where id = c.id;
  perform private.claim_event(c, 'handler_assigned', 'insurer', 'insurer',
    case when p_handler = v_user then 'Taken by the handler.' else 'Assigned to ' || coalesce(v_email, 'a colleague') || '.' end);
  perform private.write_audit(c.fleet_id, 'claim.handler_assigned', 'claim', c.id,
    jsonb_build_object('handler_id', v_old), jsonb_build_object('handler_id', p_handler));
end $$;

create function public.list_claim_handlers(p_claim uuid)
returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = '' as $$
declare c public.claims;
begin
  perform private.require_user();
  select * into c from public.claims where id = p_claim;
  if not found or c.submitted_at is null or not private.has_permission(c.fleet_id, 'claim.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.role::text
    from public.memberships m
    join auth.users u on u.id = m.user_id
    join public.role_permissions rp on rp.role = m.role and rp.permission = 'claim.manage'
    where m.active and m.organisation_id = c.insurer_id
    order by 2;
end $$;

revoke all on function private.ensure_claim_touch(uuid, uuid),
  public.assign_claim_handler(uuid, uuid), public.list_claim_handlers(uuid) from public, anon;
grant execute on function public.assign_claim_handler(uuid, uuid), public.list_claim_handlers(uuid) to authenticated;
-- create or replace keeps existing grants on log_insurer_claim, start_claim_review, request_claim_info.
