-- Driver records: details, identity documents (private storage), consents and history.
-- Drivers read and write only their own records. Fleet staff see their own fleet's drivers; insurer staff see the drivers of
-- the fleets they insure (the same organisation chain as vehicles). All writes go through functions that check who is acting.
insert into public.permissions (code, description) values
  ('driver.read', 'See driver details, documents, consents and history');
insert into public.role_permissions (role, permission) values
  ('platform_super_admin','driver.read'), ('insurer_admin','driver.read'), ('insurer_claims','driver.read'),
  ('fleet_admin','driver.read'), ('fleet_manager','driver.read');

create function private.driver_fleet() returns uuid
language sql stable security definer set search_path = '' as $$
  select organisation_id from public.memberships where user_id = (select auth.uid()) and role = 'driver' and active limit 1
$$;
grant execute on function private.driver_fleet() to authenticated;

create table public.driver_profiles (
  user_id        uuid primary key references auth.users (id),
  fleet_id       uuid not null references public.organisations (id),
  full_name      text not null check (char_length(full_name) between 2 and 120),
  date_of_birth  date,
  licence_number text check (licence_number is null or licence_number ~ '^[A-Z0-9]{5,20}$'),
  phone          text check (phone is null or char_length(phone) <= 30),
  no_claims_declared_at      timestamptz,
  no_convictions_declared_at timestamptz,
  updated_at     timestamptz not null default now()
);
create index driver_profiles_fleet_idx on public.driver_profiles (fleet_id, full_name);

create table public.driver_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id),
  fleet_id     uuid not null references public.organisations (id),
  kind         text not null check (kind in ('licence_front','licence_back','right_to_work','proof_of_address','other')),
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) <= 200),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  expires_on   date,
  uploaded_at  timestamptz not null default now(),
  deleted_at   timestamptz
);
create index driver_documents_user_idx on public.driver_documents (user_id) where deleted_at is null;

-- Append-only: the current answer is the latest row; the wording agreed to is kept with each row.
create table public.driver_consents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id),
  fleet_id    uuid not null references public.organisations (id),
  kind        text not null check (kind in ('licence_check','data_sharing')),
  given       boolean not null,
  version     text not null,
  statement   text not null,
  recorded_at timestamptz not null default now()
);
create index driver_consents_user_idx on public.driver_consents (user_id, kind, recorded_at desc);

create table public.driver_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id),
  fleet_id   uuid not null references public.organisations (id),
  kind       text not null check (kind in ('employment','claim','conviction')),
  title      text not null check (char_length(title) between 1 and 160),
  detail     text check (detail is null or char_length(detail) <= 500),
  start_date date not null,
  end_date   date,
  amount     numeric(10,2) check (amount is null or amount >= 0),
  at_fault   boolean,
  points     integer check (points is null or points between 0 and 12),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_date is null or end_date >= start_date)
);
create index driver_records_user_idx on public.driver_records (user_id, kind) where deleted_at is null;

alter table public.driver_profiles  enable row level security;
alter table public.driver_documents enable row level security;
alter table public.driver_consents  enable row level security;
alter table public.driver_records   enable row level security;
create policy driver_profiles_read  on public.driver_profiles  for select to authenticated
  using (user_id = (select auth.uid()) or fleet_id in (select private.accessible_orgs('driver.read')));
create policy driver_documents_read on public.driver_documents for select to authenticated
  using (deleted_at is null and (user_id = (select auth.uid()) or fleet_id in (select private.accessible_orgs('driver.read'))));
create policy driver_consents_read  on public.driver_consents  for select to authenticated
  using (user_id = (select auth.uid()) or fleet_id in (select private.accessible_orgs('driver.read')));
create policy driver_records_read   on public.driver_records   for select to authenticated
  using (deleted_at is null and (user_id = (select auth.uid()) or fleet_id in (select private.accessible_orgs('driver.read'))));
revoke insert, update, delete, truncate on public.driver_profiles, public.driver_documents, public.driver_consents, public.driver_records from anon, authenticated;
revoke all on public.driver_profiles, public.driver_documents, public.driver_consents, public.driver_records from anon;

create view public.driver_consent_current with (security_invoker = true) as
  select distinct on (user_id, kind) user_id, fleet_id, kind, given, version, recorded_at
    from public.driver_consents order by user_id, kind, recorded_at desc, id desc;
revoke all on public.driver_consent_current from anon;
grant select on public.driver_consent_current to authenticated;

-- ---- functions (the person acting is always the signed-in driver, in their own fleet)
create function public.save_driver_profile(p_name text, p_dob date, p_licence text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet();
  v_name text := btrim(coalesce(p_name, '')); v_lic text := nullif(upper(regexp_replace(coalesce(p_licence, ''), '\s', '', 'g')), '');
begin
  if v_fleet is null then raise exception 'only drivers can keep a driver record' using errcode = '42501'; end if;
  if char_length(v_name) < 2 then raise exception 'enter your full name' using errcode = '22023'; end if;
  if p_dob is not null and (p_dob > current_date - interval '16 years' or p_dob < current_date - interval '110 years') then
    raise exception 'check the date of birth' using errcode = '22023'; end if;
  if v_lic is not null and v_lic !~ '^[A-Z0-9]{5,20}$' then raise exception 'check the driving licence number' using errcode = '22023'; end if;
  insert into public.driver_profiles (user_id, fleet_id, full_name, date_of_birth, licence_number, phone)
  values (v_user, v_fleet, v_name, p_dob, v_lic, nullif(btrim(coalesce(p_phone, '')), ''))
  on conflict (user_id) do update set full_name = excluded.full_name, date_of_birth = excluded.date_of_birth,
    licence_number = excluded.licence_number, phone = excluded.phone, updated_at = now();
  perform private.write_audit(v_fleet, 'driver.profile_saved', 'driver', v_user, null, null);
end $$;

create function public.add_driver_document(p_kind text, p_path text, p_name text, p_type text, p_size integer, p_expires date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet(); v_id uuid;
begin
  if v_fleet is null then raise exception 'only drivers can upload their documents' using errcode = '42501'; end if;
  if p_path is null or p_path not like v_fleet::text || '/' || v_user::text || '/%' then
    raise exception 'that file is not in your folder' using errcode = '42501'; end if;
  if (select count(*) from public.driver_documents where user_id = v_user and kind = p_kind and deleted_at is null) >= 5 then
    raise exception 'you already have five files of that type; remove one first' using errcode = '22023'; end if;
  insert into public.driver_documents (user_id, fleet_id, kind, storage_path, file_name, content_type, size_bytes, expires_on)
  values (v_user, v_fleet, p_kind, p_path, left(coalesce(p_name, 'file'), 200), p_type, p_size, p_expires) returning id into v_id;
  perform private.write_audit(v_fleet, 'driver.document_added', 'driver_document', v_id, null, jsonb_build_object('kind', p_kind, 'user_id', v_user));
  return v_id;
end $$;

create function public.remove_driver_document(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); d public.driver_documents;
begin
  select * into d from public.driver_documents where id = p_id and user_id = v_user and deleted_at is null for update;
  if not found then raise exception 'file not found' using errcode = '42501'; end if;
  update public.driver_documents set deleted_at = now() where id = d.id;
  perform private.write_audit(d.fleet_id, 'driver.document_removed', 'driver_document', d.id, null, jsonb_build_object('kind', d.kind, 'user_id', v_user));
  return d.storage_path;
end $$;

create function public.record_driver_consent(p_kind text, p_given boolean, p_version text, p_statement text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet();
begin
  if v_fleet is null then raise exception 'only drivers can give consent' using errcode = '42501'; end if;
  if p_kind not in ('licence_check','data_sharing') then raise exception 'unknown consent' using errcode = '22023'; end if;
  if coalesce(p_version, '') = '' or coalesce(p_statement, '') = '' then raise exception 'consent wording is missing' using errcode = '22023'; end if;
  insert into public.driver_consents (user_id, fleet_id, kind, given, version, statement) values (v_user, v_fleet, p_kind, coalesce(p_given, false), p_version, p_statement);
  perform private.write_audit(v_fleet, case when p_given then 'driver.consent_given' else 'driver.consent_withdrawn' end, 'driver', v_user, null,
    jsonb_build_object('consent', p_kind, 'version', p_version));
end $$;

create function public.add_driver_record(p_kind text, p_title text, p_detail text, p_start date, p_end date, p_amount numeric, p_at_fault boolean, p_points integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet(); v_id uuid;
begin
  if v_fleet is null then raise exception 'only drivers can keep a driver record' using errcode = '42501'; end if;
  if p_kind not in ('employment','claim','conviction') then raise exception 'unknown record type' using errcode = '22023'; end if;
  if btrim(coalesce(p_title, '')) = '' or p_start is null then raise exception 'enter the details and the date' using errcode = '22023'; end if;
  if p_start > current_date then raise exception 'the date cannot be in the future' using errcode = '22023'; end if;
  if (select count(*) from public.driver_records where user_id = v_user and kind = p_kind and deleted_at is null) >= 50 then
    raise exception 'too many entries; contact your fleet administrator' using errcode = '22023'; end if;
  insert into public.driver_records (user_id, fleet_id, kind, title, detail, start_date, end_date, amount, at_fault, points)
  values (v_user, v_fleet, p_kind, btrim(p_title), nullif(btrim(coalesce(p_detail, '')), ''), p_start, p_end,
          case when p_kind = 'claim' then p_amount end, case when p_kind = 'claim' then p_at_fault end, case when p_kind = 'conviction' then p_points end)
  returning id into v_id;
  if p_kind = 'claim' then update public.driver_profiles set no_claims_declared_at = null where user_id = v_user; end if;
  if p_kind = 'conviction' then update public.driver_profiles set no_convictions_declared_at = null where user_id = v_user; end if;
  perform private.write_audit(v_fleet, 'driver.record_added', 'driver_record', v_id, null, jsonb_build_object('kind', p_kind, 'user_id', v_user));
  return v_id;
end $$;

create function public.remove_driver_record(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); r public.driver_records;
begin
  select * into r from public.driver_records where id = p_id and user_id = v_user and deleted_at is null for update;
  if not found then raise exception 'entry not found' using errcode = '42501'; end if;
  update public.driver_records set deleted_at = now() where id = r.id;
  perform private.write_audit(r.fleet_id, 'driver.record_removed', 'driver_record', r.id, null, jsonb_build_object('kind', r.kind, 'user_id', v_user));
end $$;

create function public.declare_none(p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_fleet uuid := private.driver_fleet();
begin
  if v_fleet is null then raise exception 'only drivers can keep a driver record' using errcode = '42501'; end if;
  if not exists (select 1 from public.driver_profiles where user_id = v_user) then raise exception 'save your details first' using errcode = '22023'; end if;
  if p_kind = 'claims' then
    if exists (select 1 from public.driver_records where user_id = v_user and kind = 'claim' and deleted_at is null) then raise exception 'remove your claims entries first' using errcode = '22023'; end if;
    update public.driver_profiles set no_claims_declared_at = now() where user_id = v_user;
  elsif p_kind = 'convictions' then
    if exists (select 1 from public.driver_records where user_id = v_user and kind = 'conviction' and deleted_at is null) then raise exception 'remove your convictions entries first' using errcode = '22023'; end if;
    update public.driver_profiles set no_convictions_declared_at = now() where user_id = v_user;
  else raise exception 'unknown declaration' using errcode = '22023'; end if;
  perform private.write_audit(v_fleet, 'driver.declared_none', 'driver', v_user, null, jsonb_build_object('declaration', p_kind));
end $$;

-- Staff opening a document leaves a trace in the audit trail.
create function public.log_driver_document_view(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.driver_documents; v_actor uuid := private.require_user();
begin
  select * into d from public.driver_documents where id = p_id and deleted_at is null;
  if not found then raise exception 'file not found' using errcode = '42501'; end if;
  if d.user_id = v_actor then return; end if;
  if not private.has_permission(d.fleet_id, 'driver.read') then raise exception 'permission denied' using errcode = '42501'; end if;
  perform private.write_audit(d.fleet_id, 'driver.document_viewed', 'driver_document', d.id, null, jsonb_build_object('kind', d.kind, 'user_id', d.user_id));
end $$;

revoke all on function public.save_driver_profile(text, date, text, text), public.add_driver_document(text, text, text, text, integer, date),
  public.remove_driver_document(uuid), public.record_driver_consent(text, boolean, text, text),
  public.add_driver_record(text, text, text, date, date, numeric, boolean, integer), public.remove_driver_record(uuid),
  public.declare_none(text), public.log_driver_document_view(uuid) from public, anon;
grant execute on function public.save_driver_profile(text, date, text, text), public.add_driver_document(text, text, text, text, integer, date),
  public.remove_driver_document(uuid), public.record_driver_consent(text, boolean, text, text),
  public.add_driver_record(text, text, text, date, date, numeric, boolean, integer), public.remove_driver_record(uuid),
  public.declare_none(text), public.log_driver_document_view(uuid) to authenticated;

-- ---- private file storage: path is <fleet id>/<driver user id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-documents', 'driver-documents', false, 4194304, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
create policy driver_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-documents'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select private.driver_fleet())::text);
create policy driver_files_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents'
    and ((storage.foldername(name))[2] = (select auth.uid())::text
      or (storage.foldername(name))[1] in (select a::text from private.accessible_orgs('driver.read') a)));
create policy driver_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'driver-documents' and (storage.foldername(name))[2] = (select auth.uid())::text);
