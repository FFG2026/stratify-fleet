-- Claims / FNOL.
-- A driver or the fleet reports an incident. It stays with the fleet until fleet staff review it and send it to the insurer.
-- From then on the insurer can update it, ask for more information (shown on the fleet's side of the claim) and close it.
-- An insurer can also log a claim itself; the fleet is notified. Nothing here talks to the MID/MIB: a claim is a claim record only,
-- and sending one to an insurer says nothing about whether the insurer will accept it or whether cover applies.
-- Writes go through functions that check who is acting. Evidence (photos, documents) cannot be removed once a claim is sent.

insert into public.permissions (code, description) values
  ('claim.read',   'See the fleet''s own claims'),
  ('claim.report', 'Report a claim for the fleet, add details and photos, answer insurer questions'),
  ('claim.submit', 'Review a reported claim and send it to the insurer'),
  ('claim.manage', 'Insurer: log, update, ask questions about and close claims that have been sent');
insert into public.role_permissions (role, permission) values
  ('fleet_admin','claim.read'), ('fleet_admin','claim.report'), ('fleet_admin','claim.submit'),
  ('fleet_manager','claim.read'), ('fleet_manager','claim.report'), ('fleet_manager','claim.submit'),
  ('insurer_admin','claim.read'), ('insurer_admin','claim.manage'),
  ('insurer_claims','claim.read'), ('insurer_claims','claim.manage'),
  ('platform_super_admin','claim.read'), ('platform_super_admin','claim.manage');

-- ---- helpers
create function private.member_has(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.role_permissions rp on rp.role = m.role and rp.permission = p_perm
    where m.user_id = (select auth.uid()) and m.active and m.organisation_id = p_org)
$$;

create sequence public.claim_ref_seq;
revoke all on sequence public.claim_ref_seq from public, anon, authenticated;
create function private.next_claim_ref() returns text
language sql security definer set search_path = '' as $$
  select 'CLM-' || to_char(now() at time zone 'Europe/London', 'YYYY') || '-' || lpad(nextval('public.claim_ref_seq')::text, 6, '0')
$$;

-- ---- tables
create table public.claims (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  fleet_id         uuid not null references public.organisations (id),
  insurer_id       uuid not null references public.organisations (id),
  policy_id        uuid references public.policies (id),
  vehicle_id       uuid references public.vehicles (id),
  registration     text not null check (char_length(registration) between 2 and 12),
  driver_user_id   uuid references auth.users (id),
  driver_name      text check (driver_name is null or char_length(driver_name) <= 120),
  origin           text not null check (origin in ('driver','fleet','insurer')),
  reported_by      uuid not null references auth.users (id),
  status           text not null default 'reported' check (status in ('reported','submitted','under_review','awaiting_information','closed')),
  incident_at      timestamptz not null,
  location         text not null check (char_length(location) between 2 and 300),
  description      text not null check (char_length(description) between 10 and 4000),
  anyone_injured   boolean not null,
  injury_details   text check (injury_details is null or char_length(injury_details) <= 2000),
  police_attended  boolean,
  police_reference text check (police_reference is null or char_length(police_reference) <= 60),
  vehicle_driveable boolean,
  third_party_involved boolean,
  on_cover_at_incident boolean,
  no_photos_confirmed  boolean not null default false,
  assessed_at      timestamptz,
  assessed_by      uuid,
  assessment_notes text check (assessment_notes is null or char_length(assessment_notes) <= 2000),
  submitted_at     timestamptz,
  submitted_by     uuid,
  insurer_reference text check (insurer_reference is null or char_length(insurer_reference) <= 60),
  closed_at        timestamptz,
  closed_by        uuid,
  outcome          text check (outcome in ('settled','declined','withdrawn','no_claim_pursued','other')),
  outcome_note     text check (outcome_note is null or char_length(outcome_note) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'closed') = (closed_at is not null))
);
create index claims_fleet_idx on public.claims (fleet_id, status, incident_at desc);
create index claims_insurer_idx on public.claims (insurer_id, status, submitted_at desc);
create index claims_reporter_idx on public.claims (reported_by);
create index claims_driver_idx on public.claims (driver_user_id) where driver_user_id is not null;

create table public.claim_parties (
  id         uuid primary key default gen_random_uuid(),
  claim_id   uuid not null references public.claims (id),
  fleet_id   uuid not null references public.organisations (id),
  kind       text not null check (kind in ('third_party','witness')),
  name       text not null check (char_length(name) between 1 and 120),
  phone      text check (phone is null or char_length(phone) <= 40),
  vehicle_registration text check (vehicle_registration is null or char_length(vehicle_registration) <= 12),
  insurer_name text check (insurer_name is null or char_length(insurer_name) <= 120),
  injured    boolean,
  notes      text check (notes is null or char_length(notes) <= 1000),
  added_by   uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index claim_parties_claim_idx on public.claim_parties (claim_id) where deleted_at is null;

-- The claim's history. Append-only. visibility: shared (fleet, insurer and the reporting driver), fleet (fleet staff only), insurer (insurer only).
create table public.claim_events (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims (id),
  fleet_id    uuid not null references public.organisations (id),
  kind        text not null,
  side        text not null check (side in ('driver','fleet','insurer')),
  visibility  text not null check (visibility in ('shared','fleet','insurer')),
  actor_id    uuid,
  actor_label text,
  actor_email text,
  body        text check (body is null or char_length(body) <= 4000),
  created_at  timestamptz not null default now()
);
create index claim_events_claim_idx on public.claim_events (claim_id, created_at);
create trigger claim_events_append_only before update or delete on public.claim_events for each row execute function private.forbid_mutation();

create table public.claim_requests (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims (id),
  fleet_id     uuid not null references public.organisations (id),
  question     text not null check (char_length(question) between 3 and 2000),
  due_on       date,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  answered_at  timestamptz,
  answered_by  uuid,
  answer       text check (answer is null or char_length(answer) <= 4000),
  cancelled_at timestamptz,
  cancelled_by uuid
);
create index claim_requests_claim_idx on public.claim_requests (claim_id, requested_at);

create table public.claim_attachments (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims (id),
  fleet_id     uuid not null references public.organisations (id),
  request_id   uuid references public.claim_requests (id),
  kind         text not null check (kind in ('photo','document')),
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) <= 200),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  caption      text check (caption is null or char_length(caption) <= 200),
  uploaded_by  uuid not null,
  uploaded_side text not null check (uploaded_side in ('driver','fleet','insurer')),
  uploaded_at  timestamptz not null default now(),
  deleted_at   timestamptz
);
create index claim_attachments_claim_idx on public.claim_attachments (claim_id) where deleted_at is null;

-- In-portal notices. Addressed to a person, or to everyone in an organisation who holds a permission.
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id),
  perm            text,
  user_id         uuid,
  claim_id        uuid references public.claims (id),
  kind            text not null,
  title           text not null check (char_length(title) <= 200),
  body            text check (body is null or char_length(body) <= 500),
  created_at      timestamptz not null default now(),
  check (user_id is not null or (organisation_id is not null and perm is not null))
);
create index notifications_org_idx on public.notifications (organisation_id, created_at desc);
create index notifications_user_idx on public.notifications (user_id, created_at desc) where user_id is not null;
create table public.notification_reads (
  notification_id uuid not null references public.notifications (id),
  user_id         uuid not null,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ---- who is on which side of a claim
create function private.claim_sides(p_claim uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_remove(array[
    case when private.member_has(c.fleet_id, 'claim.read') then 'fleet' end,
    case when c.status <> 'reported' and c.fleet_id in (select private.accessible_orgs('claim.manage')) then 'insurer' end,
    case when c.fleet_id = (select private.driver_fleet())
           and (c.reported_by = (select auth.uid()) or c.driver_user_id = (select auth.uid())) then 'driver' end
  ], null), '{}'::text[])
  from public.claims c where c.id = p_claim
$$;
grant execute on function private.claim_sides(uuid) to authenticated;

create function private.can_attach(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case
    when c.status = 'closed' then false
    when c.status = 'reported' then private.member_has(c.fleet_id, 'claim.report')
      or (c.fleet_id = (select private.driver_fleet()) and (c.reported_by = (select auth.uid()) or c.driver_user_id = (select auth.uid())))
    else private.member_has(c.fleet_id, 'claim.report') or c.fleet_id in (select private.accessible_orgs('claim.manage'))
  end from public.claims c where c.id = p_claim), false)
$$;
grant execute on function private.can_attach(uuid) to authenticated;

alter table public.claims            enable row level security;
alter table public.claim_parties     enable row level security;
alter table public.claim_events      enable row level security;
alter table public.claim_requests    enable row level security;
alter table public.claim_attachments enable row level security;
alter table public.notifications     enable row level security;
alter table public.notification_reads enable row level security;

create policy claims_read on public.claims for select to authenticated using (
  private.member_has(fleet_id, 'claim.read')
  or (status <> 'reported' and fleet_id in (select private.accessible_orgs('claim.manage')))
  or (fleet_id = (select private.driver_fleet()) and (reported_by = (select auth.uid()) or driver_user_id = (select auth.uid()))));
create policy claim_parties_read on public.claim_parties for select to authenticated
  using (deleted_at is null and cardinality(private.claim_sides(claim_id)) > 0);
create policy claim_requests_read on public.claim_requests for select to authenticated
  using (cardinality(private.claim_sides(claim_id)) > 0);
create policy claim_attachments_read on public.claim_attachments for select to authenticated
  using (deleted_at is null and cardinality(private.claim_sides(claim_id)) > 0);
create policy claim_events_read on public.claim_events for select to authenticated using (
  (visibility = 'shared' and cardinality(private.claim_sides(claim_id)) > 0)
  or (visibility = 'fleet' and 'fleet' = any (private.claim_sides(claim_id)))
  or (visibility = 'insurer' and 'insurer' = any (private.claim_sides(claim_id))));
create policy notifications_read on public.notifications for select to authenticated using (
  user_id = (select auth.uid()) or (user_id is null and private.member_has(organisation_id, perm)));
create policy notification_reads_read on public.notification_reads for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.claims, public.claim_parties, public.claim_events, public.claim_requests, public.claim_attachments,
  public.notifications, public.notification_reads from anon;
revoke insert, update, delete, truncate on public.claims, public.claim_parties, public.claim_events, public.claim_requests,
  public.claim_attachments, public.notifications, public.notification_reads from authenticated;

create view public.my_notifications with (security_invoker = true) as
  select n.id, n.claim_id, n.kind, n.title, n.body, n.created_at, r.read_at
  from public.notifications n
  left join public.notification_reads r on r.notification_id = n.id and r.user_id = (select auth.uid());
revoke all on public.my_notifications from anon;
grant select on public.my_notifications to authenticated;

-- ---- internal helpers used by the functions below
create function private.claim_event(c public.claims, p_kind text, p_side text, p_vis text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_label text;
begin
  v_label := case p_side
    when 'driver' then coalesce((select full_name from public.driver_profiles where user_id = v_actor), 'Driver')
    when 'fleet' then (select name from public.organisations where id = c.fleet_id)
    else (select name from public.organisations where id = c.insurer_id) end;
  insert into public.claim_events (claim_id, fleet_id, kind, side, visibility, actor_id, actor_label, actor_email, body)
  values (c.id, c.fleet_id, p_kind, p_side, p_vis, v_actor, v_label,
          case when p_side = 'driver' then null else (select email from auth.users where id = v_actor) end, p_body);
end $$;

create function private.notify(p_org uuid, p_perm text, p_user uuid, p_claim uuid, p_kind text, p_title text, p_body text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (organisation_id, perm, user_id, claim_id, kind, title, body)
  values (case when p_user is null then p_org end, case when p_user is null then p_perm end, p_user, p_claim, p_kind, left(p_title, 200), left(p_body, 500))
$$;

-- What a claim still needs before the fleet can send it.
create function private.claim_gaps(c public.claims) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare g text[] := '{}';
begin
  if c.police_attended is null then g := g || 'say whether the police attended'; end if;
  if c.third_party_involved is null then g := g || 'say whether another vehicle or person was involved'; end if;
  if c.third_party_involved and not exists (select 1 from public.claim_parties p where p.claim_id = c.id and p.kind = 'third_party' and p.deleted_at is null) then
    g := g || 'add the other party''s details'; end if;
  if not c.no_photos_confirmed and not exists (select 1 from public.claim_attachments a where a.claim_id = c.id and a.deleted_at is null) then
    g := g || 'add photos, or confirm that none are available'; end if;
  return g;
end $$;

create function private.check_claim_fields(p_incident timestamptz, p_location text, p_description text, p_injured boolean, p_injury text) returns void
language plpgsql immutable as $$
begin
  if p_incident is null then raise exception 'enter when it happened' using errcode = '22023'; end if;
  if p_incident > now() + interval '10 minutes' then raise exception 'the incident cannot be in the future' using errcode = '22023'; end if;
  if p_incident < now() - interval '5 years' then raise exception 'check the date of the incident' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_location, ''))) < 2 then raise exception 'say where it happened' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 10 then raise exception 'describe what happened (at least a sentence)' using errcode = '22023'; end if;
  if p_injured is null then raise exception 'say whether anyone was injured' using errcode = '22023'; end if;
  if p_injured and char_length(btrim(coalesce(p_injury, ''))) < 3 then raise exception 'say who was injured and how' using errcode = '22023'; end if;
end $$;

create function private.cover_at(p_vehicle uuid, p_at timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select policy_id from public.coverage_periods
  where vehicle_id = p_vehicle and voided_at is null and cover_start <= p_at and (cover_end is null or cover_end > p_at) limit 1
$$;

-- ---- reporting
create function public.report_claim(
  p_fleet uuid, p_vehicle uuid, p_registration text, p_driver uuid, p_driver_name text, p_incident_at timestamptz,
  p_location text, p_description text, p_injured boolean, p_injury_details text,
  p_police boolean, p_police_ref text, p_driveable boolean, p_third_party boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_dfleet uuid := private.driver_fleet();
  v_fleet uuid; v_origin text; v_driver uuid; v_name text; v_reg text; v_policy uuid; v_id uuid; v_insurer uuid; v_day date;
begin
  if p_fleet is not null and private.member_has(p_fleet, 'claim.report') then
    v_fleet := p_fleet; v_origin := 'fleet';
  elsif v_dfleet is not null and (p_fleet is null or p_fleet = v_dfleet) then
    v_fleet := v_dfleet; v_origin := 'driver';
  else raise exception 'permission denied' using errcode = '42501'; end if;
  select insurer_id into v_insurer from public.organisations where id = v_fleet and kind = 'fleet';
  if v_insurer is null then raise exception 'fleet not found' using errcode = '22023'; end if;
  perform private.check_claim_fields(p_incident_at, p_location, p_description, p_injured, p_injury_details);
  v_day := (p_incident_at at time zone 'Europe/London')::date;

  if v_origin = 'driver' then
    v_driver := v_user;
    v_name := (select full_name from public.driver_profiles where user_id = v_user);
  else
    if p_driver is not null then
      if not exists (select 1 from public.memberships m where m.user_id = p_driver and m.organisation_id = v_fleet and m.role = 'driver' and m.active) then
        raise exception 'that person is not an active driver in this fleet' using errcode = '22023'; end if;
      v_driver := p_driver;
      v_name := (select full_name from public.driver_profiles where user_id = p_driver);
    end if;
    v_name := coalesce(v_name, nullif(btrim(coalesce(p_driver_name, '')), ''));
  end if;

  if p_vehicle is not null then
    select registration into v_reg from public.vehicles where id = p_vehicle and fleet_id = v_fleet;
    if v_reg is null then raise exception 'that vehicle is not in this fleet' using errcode = '22023'; end if;
    if v_origin = 'driver' and not exists (select 1 from public.vehicle_assignments a where a.user_id = v_user and a.vehicle_id = p_vehicle
        and a.assigned_from <= v_day and (a.assigned_to is null or a.assigned_to >= v_day)) then
      raise exception 'that vehicle was not assigned to you on that date' using errcode = '22023'; end if;
    v_policy := private.cover_at(p_vehicle, p_incident_at);
  else
    v_reg := private.normalise_registration(p_registration);
    if not private.is_valid_registration(v_reg) then raise exception 'check the registration' using errcode = '22023'; end if;
  end if;

  insert into public.claims (reference, fleet_id, insurer_id, policy_id, vehicle_id, registration, driver_user_id, driver_name, origin, reported_by,
      incident_at, location, description, anyone_injured, injury_details, police_attended, police_reference, vehicle_driveable, third_party_involved, on_cover_at_incident)
  values (private.next_claim_ref(), v_fleet, v_insurer, v_policy, p_vehicle, v_reg, v_driver, v_name, v_origin, v_user,
      p_incident_at, btrim(p_location), btrim(p_description), p_injured, case when p_injured then btrim(p_injury_details) end,
      p_police, case when p_police then nullif(btrim(coalesce(p_police_ref, '')), '') end, p_driveable, p_third_party,
      case when p_vehicle is null then null else v_policy is not null end)
  returning id into v_id;
  perform private.claim_event((select c from public.claims c where c.id = v_id), 'reported', v_origin, 'shared',
    case v_origin when 'driver' then 'Reported by the driver.' else 'Reported by the fleet.' end);
  if v_origin = 'driver' then
    perform private.notify(v_fleet, 'claim.submit', null, v_id, 'claim_reported', 'New claim reported by ' || coalesce(v_name, 'a driver'),
      v_reg || ' · ' || to_char(p_incident_at at time zone 'Europe/London', 'DD/MM/YYYY HH24:MI') || case when p_injured then ' · someone was injured' else '' end);
  end if;
  perform private.write_audit(v_fleet, 'claim.reported', 'claim', v_id, null, jsonb_build_object('origin', v_origin, 'registration', v_reg));
  return v_id;
end $$;

-- Fleet staff or the reporting driver may change a report until it is sent. A change means it has to be reviewed again.
create function public.update_claim_details(
  p_claim uuid, p_vehicle uuid, p_registration text, p_incident_at timestamptz, p_location text, p_description text,
  p_injured boolean, p_injury_details text, p_police boolean, p_police_ref text, p_driveable boolean, p_third_party boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); c public.claims; v_side text; v_reg text; v_policy uuid;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'claim not found' using errcode = '42501'; end if;
  if private.member_has(c.fleet_id, 'claim.report') then v_side := 'fleet';
  elsif c.fleet_id = (select private.driver_fleet()) and (c.reported_by = v_user or c.driver_user_id = v_user) then v_side := 'driver';
  else raise exception 'permission denied' using errcode = '42501'; end if;
  if c.status <> 'reported' then raise exception 'this claim has been sent to the insurer; add a note or photos instead' using errcode = '22023'; end if;
  perform private.check_claim_fields(p_incident_at, p_location, p_description, p_injured, p_injury_details);
  v_reg := c.registration;
  if v_side = 'fleet' then
    if p_vehicle is not null then
      select registration into v_reg from public.vehicles where id = p_vehicle and fleet_id = c.fleet_id;
      if v_reg is null then raise exception 'that vehicle is not in this fleet' using errcode = '22023'; end if;
      c.vehicle_id := p_vehicle;
    elsif nullif(btrim(coalesce(p_registration, '')), '') is not null then
      v_reg := private.normalise_registration(p_registration);
      if not private.is_valid_registration(v_reg) then raise exception 'check the registration' using errcode = '22023'; end if;
      if v_reg <> c.registration then c.vehicle_id := null; end if;
    end if;
  end if;
  v_policy := case when c.vehicle_id is null then null else private.cover_at(c.vehicle_id, p_incident_at) end;
  update public.claims set vehicle_id = c.vehicle_id, registration = v_reg, incident_at = p_incident_at, location = btrim(p_location), description = btrim(p_description),
      anyone_injured = p_injured, injury_details = case when p_injured then btrim(p_injury_details) end, police_attended = p_police,
      police_reference = case when p_police then nullif(btrim(coalesce(p_police_ref, '')), '') end, vehicle_driveable = p_driveable, third_party_involved = p_third_party,
      policy_id = v_policy, on_cover_at_incident = case when c.vehicle_id is null then null else v_policy is not null end,
      assessed_at = null, assessed_by = null, updated_at = now()
  where id = c.id;
  perform private.claim_event(c, 'updated', v_side, 'shared', 'Details changed' || case when c.assessed_at is not null then '; the report needs reviewing again.' else '.' end);
  perform private.write_audit(c.fleet_id, 'claim.details_changed', 'claim', c.id, to_jsonb(c) - 'description', null);
end $$;

create function public.add_claim_party(p_claim uuid, p_kind text, p_name text, p_phone text, p_reg text, p_insurer text, p_injured boolean, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); c public.claims; v_id uuid; v_side text;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'claim not found' using errcode = '42501'; end if;
  if private.member_has(c.fleet_id, 'claim.report') then v_side := 'fleet';
  elsif c.status = 'reported' and c.fleet_id = (select private.driver_fleet()) and (c.reported_by = v_user or c.driver_user_id = v_user) then v_side := 'driver';
  else raise exception 'permission denied' using errcode = '42501'; end if;
  if c.status = 'closed' then raise exception 'this claim is closed' using errcode = '22023'; end if;
  if p_kind not in ('third_party','witness') then raise exception 'unknown type' using errcode = '22023'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'enter a name' using errcode = '22023'; end if;
  if (select count(*) from public.claim_parties where claim_id = c.id and deleted_at is null) >= 20 then raise exception 'too many people on this claim' using errcode = '22023'; end if;
  insert into public.claim_parties (claim_id, fleet_id, kind, name, phone, vehicle_registration, insurer_name, injured, notes, added_by)
  values (c.id, c.fleet_id, p_kind, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(upper(regexp_replace(coalesce(p_reg, ''), '\s', '', 'g')), ''),
          nullif(btrim(coalesce(p_insurer, '')), ''), p_injured, nullif(btrim(coalesce(p_notes, '')), ''), v_user) returning id into v_id;
  if c.status = 'reported' then update public.claims set assessed_at = null, assessed_by = null, updated_at = now() where id = c.id;
  else perform private.claim_event(c, 'party_added', v_side, 'shared', case p_kind when 'witness' then 'Witness' else 'Other party' end || ' added: ' || btrim(p_name)); end if;
  perform private.write_audit(c.fleet_id, 'claim.party_added', 'claim', c.id, null, jsonb_build_object('kind', p_kind));
  return v_id;
end $$;

create function public.remove_claim_party(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); p public.claim_parties; c public.claims;
begin
  select * into p from public.claim_parties where id = p_id and deleted_at is null for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select * into c from public.claims where id = p.claim_id for update;
  if c.status <> 'reported' then raise exception 'this claim has been sent to the insurer; details can no longer be removed' using errcode = '22023'; end if;
  if not (private.member_has(c.fleet_id, 'claim.report') or (c.fleet_id = (select private.driver_fleet()) and (c.reported_by = v_user or c.driver_user_id = v_user))) then
    raise exception 'permission denied' using errcode = '42501'; end if;
  update public.claim_parties set deleted_at = now() where id = p.id;
  update public.claims set assessed_at = null, assessed_by = null, updated_at = now() where id = c.id;
  perform private.write_audit(c.fleet_id, 'claim.party_removed', 'claim', c.id, null, jsonb_build_object('kind', p.kind));
end $$;

-- ---- files
create function public.add_claim_attachment(p_claim uuid, p_request uuid, p_kind text, p_path text, p_name text, p_type text, p_size integer, p_caption text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); c public.claims; v_id uuid; v_side text;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or not private.can_attach(p_claim) then raise exception 'permission denied' using errcode = '42501'; end if;
  v_side := case when private.member_has(c.fleet_id, 'claim.report') then 'fleet'
                 when c.fleet_id in (select private.accessible_orgs('claim.manage')) and c.status <> 'reported' then 'insurer' else 'driver' end;
  if p_kind not in ('photo','document') then raise exception 'unknown file type' using errcode = '22023'; end if;
  if p_path is null or p_path !~ ('^' || c.fleet_id::text || '/' || c.id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') then
    raise exception 'that file is not in this claim''s folder' using errcode = '42501'; end if;
  if (select count(*) from public.claim_attachments where claim_id = c.id and deleted_at is null) >= 40 then
    raise exception 'this claim already has 40 files' using errcode = '22023'; end if;
  if p_request is not null and not exists (select 1 from public.claim_requests r where r.id = p_request and r.claim_id = c.id and r.answered_at is null and r.cancelled_at is null) then
    raise exception 'that question has already been answered' using errcode = '22023'; end if;
  insert into public.claim_attachments (claim_id, fleet_id, request_id, kind, storage_path, file_name, content_type, size_bytes, caption, uploaded_by, uploaded_side)
  values (c.id, c.fleet_id, p_request, p_kind, p_path, left(coalesce(p_name, 'file'), 200), p_type, p_size, nullif(left(btrim(coalesce(p_caption, '')), 200), ''), v_user, v_side)
  returning id into v_id;
  if c.status = 'reported' then update public.claims set no_photos_confirmed = false, updated_at = now() where id = c.id; end if;
  perform private.write_audit(c.fleet_id, 'claim.file_added', 'claim', c.id, null, jsonb_build_object('attachment', v_id, 'kind', p_kind, 'side', v_side));
  return v_id;
end $$;

-- Only the person who added a file, and only while the claim has not been sent.
create function public.remove_claim_attachment(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); a public.claim_attachments; c public.claims;
begin
  select * into a from public.claim_attachments where id = p_id and deleted_at is null for update;
  if not found or a.uploaded_by <> v_user then raise exception 'file not found' using errcode = '42501'; end if;
  select * into c from public.claims where id = a.claim_id for update;
  if c.status <> 'reported' then raise exception 'files cannot be removed once a claim has been sent' using errcode = '22023'; end if;
  update public.claim_attachments set deleted_at = now() where id = a.id;
  update public.claims set assessed_at = null, assessed_by = null, updated_at = now() where id = c.id;
  perform private.write_audit(c.fleet_id, 'claim.file_removed', 'claim', c.id, null, jsonb_build_object('attachment', a.id));
  return a.storage_path;
end $$;

create function public.log_claim_file_view(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.claim_attachments; v_user uuid := private.require_user();
begin
  select * into a from public.claim_attachments where id = p_id and deleted_at is null;
  if not found or cardinality(private.claim_sides(a.claim_id)) = 0 then raise exception 'file not found' using errcode = '42501'; end if;
  if a.uploaded_by = v_user then return; end if;
  perform private.write_audit(a.fleet_id, 'claim.file_viewed', 'claim', a.claim_id, null, jsonb_build_object('attachment', a.id));
end $$;

-- ---- fleet review and sending
create function public.assess_claim(p_claim uuid, p_notes text, p_no_photos boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); c public.claims; g text[];
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or not private.member_has(c.fleet_id, 'claim.submit') then raise exception 'permission denied' using errcode = '42501'; end if;
  if c.status <> 'reported' then raise exception 'this claim has already been sent' using errcode = '22023'; end if;
  c.no_photos_confirmed := coalesce(p_no_photos, false) and not exists (select 1 from public.claim_attachments a where a.claim_id = c.id and a.deleted_at is null);
  g := private.claim_gaps(c);
  if cardinality(g) > 0 then raise exception 'before reviewing: %', g[1] using errcode = '22023'; end if;
  update public.claims set assessed_at = now(), assessed_by = v_user, assessment_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      no_photos_confirmed = c.no_photos_confirmed, updated_at = now() where id = c.id;
  perform private.claim_event(c, 'assessed', 'fleet', 'fleet', coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Reviewed by the fleet.'));
  perform private.write_audit(c.fleet_id, 'claim.assessed', 'claim', c.id, null, null);
end $$;

create function public.submit_claim(p_claim uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); c public.claims; g text[];
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or not private.member_has(c.fleet_id, 'claim.submit') then raise exception 'permission denied' using errcode = '42501'; end if;
  if c.status <> 'reported' then raise exception 'this claim has already been sent' using errcode = '22023'; end if;
  if c.assessed_at is null then raise exception 'review the claim before sending it' using errcode = '22023'; end if;
  g := private.claim_gaps(c);
  if cardinality(g) > 0 then raise exception 'before sending: %', g[1] using errcode = '22023'; end if;
  update public.claims set status = 'submitted', submitted_at = now(), submitted_by = v_user, updated_at = now() where id = c.id;
  perform private.claim_event(c, 'submitted', 'fleet', 'shared', 'Sent to the insurer.');
  perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'claim_submitted', 'New claim from ' || (select name from public.organisations where id = c.fleet_id),
    c.reference || ' · ' || c.registration || case when c.anyone_injured then ' · someone was injured' else '' end);
  perform private.write_audit(c.fleet_id, 'claim.submitted', 'claim', c.id, null, jsonb_build_object('insurer', c.insurer_id));
end $$;

-- A report that is not a claim (a duplicate, or made in error) is closed by the fleet before it is sent.
create function public.withdraw_claim(p_claim uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); c public.claims;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or not private.member_has(c.fleet_id, 'claim.submit') then raise exception 'permission denied' using errcode = '42501'; end if;
  if c.status <> 'reported' then raise exception 'this claim has already been sent; ask the insurer to close it' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why this report is being withdrawn' using errcode = '22023'; end if;
  update public.claims set status = 'closed', closed_at = now(), closed_by = v_user, outcome = 'withdrawn', outcome_note = btrim(p_note), updated_at = now() where id = c.id;
  perform private.claim_event(c, 'closed', 'fleet', 'shared', 'Withdrawn by the fleet before it was sent: ' || btrim(p_note));
  if coalesce(c.driver_user_id, case when c.origin = 'driver' then c.reported_by end) is distinct from v_user
     and coalesce(c.driver_user_id, case when c.origin = 'driver' then c.reported_by end) is not null then
    perform private.notify(null, null, coalesce(c.driver_user_id, c.reported_by), c.id, 'claim_closed', c.reference || ' was withdrawn by your fleet', btrim(p_note));
  end if;
  perform private.write_audit(c.fleet_id, 'claim.withdrawn', 'claim', c.id, null, null);
end $$;

-- ---- insurer
create function public.log_insurer_claim(
  p_fleet uuid, p_vehicle uuid, p_registration text, p_driver uuid, p_driver_name text, p_incident_at timestamptz, p_location text, p_description text,
  p_injured boolean, p_injury_details text, p_police boolean, p_police_ref text, p_insurer_ref text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_insurer uuid; v_id uuid; v_reg text; v_policy uuid; v_name text; v_driver uuid; c public.claims;
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
  insert into public.claims (reference, fleet_id, insurer_id, policy_id, vehicle_id, registration, driver_user_id, driver_name, origin, reported_by, status,
      incident_at, location, description, anyone_injured, injury_details, police_attended, police_reference, on_cover_at_incident, submitted_at, submitted_by, insurer_reference)
  values (private.next_claim_ref(), p_fleet, v_insurer, v_policy, p_vehicle, v_reg, v_driver, v_name, 'insurer', v_user, 'under_review',
      p_incident_at, btrim(p_location), btrim(p_description), p_injured, case when p_injured then btrim(p_injury_details) end, p_police,
      case when p_police then nullif(btrim(coalesce(p_police_ref, '')), '') end, case when p_vehicle is null then null else v_policy is not null end,
      now(), v_user, nullif(btrim(coalesce(p_insurer_ref, '')), ''))
  returning * into c;
  v_id := c.id;
  perform private.claim_event(c, 'logged_by_insurer', 'insurer', 'shared', 'Logged by the insurer.');
  perform private.notify(p_fleet, 'claim.submit', null, v_id, 'claim_logged', 'A claim has been logged by your insurer',
    c.reference || ' · ' || v_reg || ' · ' || to_char(p_incident_at at time zone 'Europe/London', 'DD/MM/YYYY') || '. Please check it and add anything you know.');
  if v_driver is not null then
    perform private.notify(null, null, v_driver, v_id, 'claim_logged', 'A claim has been logged against you', c.reference || ' · ' || v_reg);
  end if;
  perform private.write_audit(p_fleet, 'claim.logged_by_insurer', 'claim', v_id, null, jsonb_build_object('registration', v_reg, 'insurer', v_insurer));
  return v_id;
end $$;

create function private.insurer_claim(p_claim uuid) returns public.claims
language plpgsql security definer set search_path = '' as $$
declare c public.claims;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or c.status = 'reported' or not private.has_permission(c.fleet_id, 'claim.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return c;
end $$;

create function public.start_claim_review(p_claim uuid, p_insurer_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_ref text := nullif(btrim(coalesce(p_insurer_ref, '')), '');
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
  perform private.write_audit(c.fleet_id, 'claim.review_started', 'claim', c.id, null, null);
end $$;

create function public.request_claim_info(p_claim uuid, p_question text, p_due date) returns uuid
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
  perform private.write_audit(c.fleet_id, 'claim.info_requested', 'claim', c.id, null, jsonb_build_object('request', v_id));
  return v_id;
end $$;

create function private.settle_status(p_claim uuid) returns void
language sql security definer set search_path = '' as $$
  update public.claims set status = case when exists (select 1 from public.claim_requests r where r.claim_id = p_claim and r.answered_at is null and r.cancelled_at is null)
    then 'awaiting_information' else 'under_review' end, updated_at = now()
  where id = p_claim and status = 'awaiting_information'
$$;

create function public.cancel_claim_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.claim_requests; c public.claims; v_user uuid := private.require_user();
begin
  select * into r from public.claim_requests where id = p_request for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  c := private.insurer_claim(r.claim_id);
  if r.answered_at is not null or r.cancelled_at is not null then raise exception 'that question is no longer open' using errcode = '22023'; end if;
  update public.claim_requests set cancelled_at = now(), cancelled_by = v_user where id = r.id;
  perform private.settle_status(c.id);
  perform private.claim_event(c, 'info_cancelled', 'insurer', 'shared', 'The insurer withdrew a question: ' || left(r.question, 200));
  perform private.write_audit(c.fleet_id, 'claim.info_cancelled', 'claim', c.id, null, jsonb_build_object('request', r.id));
end $$;

create function public.respond_claim_request(p_request uuid, p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.claim_requests; c public.claims; v_user uuid := private.require_user();
begin
  select * into r from public.claim_requests where id = p_request for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select * into c from public.claims where id = r.claim_id for update;
  if not private.member_has(c.fleet_id, 'claim.report') then raise exception 'permission denied' using errcode = '42501'; end if;
  if r.answered_at is not null or r.cancelled_at is not null then raise exception 'that question is no longer open' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_answer, ''))) < 1 then raise exception 'write your answer' using errcode = '22023'; end if;
  update public.claim_requests set answered_at = now(), answered_by = v_user, answer = btrim(p_answer) where id = r.id;
  perform private.settle_status(c.id);
  perform private.claim_event(c, 'info_provided', 'fleet', 'shared', btrim(p_answer));
  perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'info_provided', 'More information on ' || c.reference, left(btrim(p_answer), 300));
  perform private.write_audit(c.fleet_id, 'claim.info_provided', 'claim', c.id, null, jsonb_build_object('request', r.id));
end $$;

create function public.add_claim_note(p_claim uuid, p_body text, p_internal boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims; v_side text; v_user uuid := private.require_user(); v_body text := btrim(coalesce(p_body, ''));
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'claim not found' using errcode = '42501'; end if;
  if private.member_has(c.fleet_id, 'claim.report') then v_side := 'fleet';
  elsif c.status <> 'reported' and private.has_permission(c.fleet_id, 'claim.manage') then v_side := 'insurer';
  else raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then raise exception 'write a note (up to 4,000 characters)' using errcode = '22023'; end if;
  perform private.claim_event(c, 'note', v_side, case when coalesce(p_internal, false) then v_side else 'shared' end, v_body);
  if not coalesce(p_internal, false) and c.status <> 'reported' then
    if v_side = 'insurer' then perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'claim_note', 'Update on ' || c.reference, left(v_body, 300));
    else perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'claim_note', 'Update on ' || c.reference, left(v_body, 300)); end if;
  end if;
  perform private.write_audit(c.fleet_id, 'claim.note_added', 'claim', c.id, null, jsonb_build_object('side', v_side, 'internal', coalesce(p_internal, false)));
end $$;

create function public.close_claim(p_claim uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_user uuid := private.require_user();
begin
  if c.status = 'closed' then raise exception 'this claim is already closed' using errcode = '22023'; end if;
  if p_outcome not in ('settled','declined','no_claim_pursued','other') then raise exception 'choose an outcome' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'add a short note for the fleet' using errcode = '22023'; end if;
  update public.claim_requests set cancelled_at = now(), cancelled_by = v_user where claim_id = c.id and answered_at is null and cancelled_at is null;
  update public.claims set status = 'closed', closed_at = now(), closed_by = v_user, outcome = p_outcome, outcome_note = btrim(p_note), updated_at = now() where id = c.id;
  perform private.claim_event(c, 'closed', 'insurer', 'shared', 'Closed by the insurer. ' || btrim(p_note));
  perform private.notify(c.fleet_id, 'claim.read', null, c.id, 'claim_closed', c.reference || ' has been closed', left(btrim(p_note), 300));
  if c.driver_user_id is not null then perform private.notify(null, null, c.driver_user_id, c.id, 'claim_closed', c.reference || ' has been closed', left(btrim(p_note), 300)); end if;
  perform private.write_audit(c.fleet_id, 'claim.closed', 'claim', c.id, null, jsonb_build_object('outcome', p_outcome));
end $$;

create function public.reopen_claim(p_claim uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim);
begin
  if c.status <> 'closed' then raise exception 'this claim is not closed' using errcode = '22023'; end if;
  if c.submitted_at is null then raise exception 'this report was never sent' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why it is being reopened' using errcode = '22023'; end if;
  update public.claims set status = 'under_review', closed_at = null, closed_by = null, outcome = null, outcome_note = null, updated_at = now() where id = c.id;
  perform private.claim_event(c, 'reopened', 'insurer', 'shared', 'Reopened by the insurer. ' || btrim(p_note));
  perform private.notify(c.fleet_id, 'claim.read', null, c.id, 'claim_status', c.reference || ' has been reopened', left(btrim(p_note), 300));
  perform private.write_audit(c.fleet_id, 'claim.reopened', 'claim', c.id, null, null);
end $$;

-- ---- notifications
create function public.mark_notifications_read(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user();
begin
  insert into public.notification_reads (notification_id, user_id)
  select n.id, v_user from public.notifications n
  where (p_ids is null or n.id = any (p_ids)) and (n.user_id = v_user or (n.user_id is null and private.member_has(n.organisation_id, n.perm)))
  on conflict do nothing;
end $$;

revoke all on function public.report_claim(uuid, uuid, text, uuid, text, timestamptz, text, text, boolean, text, boolean, text, boolean, boolean),
  public.update_claim_details(uuid, uuid, text, timestamptz, text, text, boolean, text, boolean, text, boolean, boolean),
  public.add_claim_party(uuid, text, text, text, text, text, boolean, text), public.remove_claim_party(uuid),
  public.add_claim_attachment(uuid, uuid, text, text, text, text, integer, text), public.remove_claim_attachment(uuid), public.log_claim_file_view(uuid),
  public.assess_claim(uuid, text, boolean), public.submit_claim(uuid), public.withdraw_claim(uuid, text),
  public.log_insurer_claim(uuid, uuid, text, uuid, text, timestamptz, text, text, boolean, text, boolean, text, text),
  public.start_claim_review(uuid, text), public.request_claim_info(uuid, text, date), public.cancel_claim_request(uuid),
  public.respond_claim_request(uuid, text), public.add_claim_note(uuid, text, boolean), public.close_claim(uuid, text, text),
  public.reopen_claim(uuid, text), public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.report_claim(uuid, uuid, text, uuid, text, timestamptz, text, text, boolean, text, boolean, text, boolean, boolean),
  public.update_claim_details(uuid, uuid, text, timestamptz, text, text, boolean, text, boolean, text, boolean, boolean),
  public.add_claim_party(uuid, text, text, text, text, text, boolean, text), public.remove_claim_party(uuid),
  public.add_claim_attachment(uuid, uuid, text, text, text, text, integer, text), public.remove_claim_attachment(uuid), public.log_claim_file_view(uuid),
  public.assess_claim(uuid, text, boolean), public.submit_claim(uuid), public.withdraw_claim(uuid, text),
  public.log_insurer_claim(uuid, uuid, text, uuid, text, timestamptz, text, text, boolean, text, boolean, text, text),
  public.start_claim_review(uuid, text), public.request_claim_info(uuid, text, date), public.cancel_claim_request(uuid),
  public.respond_claim_request(uuid, text), public.add_claim_note(uuid, text, boolean), public.close_claim(uuid, text, text),
  public.reopen_claim(uuid, text), public.mark_notifications_read(uuid[]) to authenticated;
-- Internal helpers are not callable through the API.
revoke all on function private.claim_event(public.claims, text, text, text, text), private.notify(uuid, text, uuid, uuid, text, text, text),
  private.claim_gaps(public.claims), private.check_claim_fields(timestamptz, text, text, boolean, text), private.cover_at(uuid, timestamptz),
  private.insurer_claim(uuid), private.settle_status(uuid), private.next_claim_ref(), private.member_has(uuid, text) from public, anon;
grant execute on function private.member_has(uuid, text) to authenticated;

-- ---- private file storage: path is <fleet id>/<claim id>/<file>
create function private.claim_path(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' then split_part(p_name, '/', 2)::uuid end
$$;
create function private.claim_file_fleet_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.claims c where c.id = private.claim_path(p_name) and c.fleet_id::text = split_part(p_name, '/', 1))
$$;
create function private.can_upload_claim_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.claim_file_fleet_ok(p_name) and private.can_attach(private.claim_path(p_name))
$$;
create function private.can_read_claim_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.claim_file_fleet_ok(p_name) and cardinality(private.claim_sides(private.claim_path(p_name))) > 0
$$;
-- A file can be deleted only when it was never registered against the claim (a failed upload) or has been removed from it.
create function private.can_delete_claim_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.claim_file_fleet_ok(p_name) and (
    exists (select 1 from public.claim_attachments a where a.storage_path = p_name and a.deleted_at is not null and a.uploaded_by = (select auth.uid()))
    or (not exists (select 1 from public.claim_attachments a where a.storage_path = p_name) and private.can_attach(private.claim_path(p_name))))
$$;
grant execute on function private.claim_path(text), private.claim_file_fleet_ok(text), private.can_upload_claim_file(text),
  private.can_read_claim_file(text), private.can_delete_claim_file(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('claim-files', 'claim-files', false, 4194304, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
create policy claim_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-files' and private.can_upload_claim_file(name));
create policy claim_files_read on storage.objects for select to authenticated
  using (bucket_id = 'claim-files' and private.can_read_claim_file(name));
create policy claim_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'claim-files' and private.can_delete_claim_file(name));
