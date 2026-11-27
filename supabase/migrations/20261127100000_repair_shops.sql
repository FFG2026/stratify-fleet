-- Repair shops (body shops).
-- An insurer sets up repairers and their people, and passes a claim to one. The shop sees only that claim's vehicle and damage details,
-- adds photos, uploads a quote and its amount, and sends it to the insurer. The insurer approves it (or sends it back with a note), and the
-- shop then does the work and marks it complete. The insurer, the TPA on the claim and the fleet can all see the repair read-only.
-- Repair people have no memberships (like TPA people), so no existing policy matches them. They read through the functions and policies below,
-- and the shop never sees the driver, injuries, police details or the insurer's private notes.

create table public.repairers (
  id         uuid primary key default gen_random_uuid(),
  insurer_id uuid not null references public.organisations (id),
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index repairers_name_per_insurer on public.repairers (insurer_id, lower(btrim(name)));

create function private.check_repairer_insurer() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.organisations o where o.id = new.insurer_id and o.kind = 'insurer') then
    raise exception 'a repairer belongs to an insurer organisation' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger repairers_check_insurer before insert or update of insurer_id on public.repairers
  for each row execute function private.check_repairer_insurer();

create table public.repairer_members (
  id          uuid primary key default gen_random_uuid(),
  repairer_id uuid not null references public.repairers (id),
  user_id     uuid not null references auth.users (id) on delete cascade,
  active      boolean not null default true,
  added_by    uuid,
  created_at  timestamptz not null default now(),
  unique (repairer_id, user_id)
);
create index repairer_members_user_idx on public.repairer_members (user_id) where active;

-- One repair job per claim, with one shop at a time.
create table public.claim_repair (
  claim_id             uuid primary key references public.claims (id),
  repairer_id          uuid not null references public.repairers (id),
  insurer_id           uuid not null references public.organisations (id),
  fleet_id             uuid not null references public.organisations (id),
  status               text not null default 'with_repairer' check (status in ('with_repairer', 'quote_submitted', 'approved', 'completed')),
  quote_amount         numeric(12,2) check (quote_amount is null or quote_amount >= 0),
  quote_note           text check (quote_note is null or char_length(quote_note) <= 2000),
  quote_submitted_at   timestamptz,
  quote_submitted_by   uuid,
  decided_at           timestamptz,
  decided_by           uuid,
  completed_at         timestamptz,
  assigned_by          uuid,
  assigned_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index claim_repair_repairer_idx on public.claim_repair (repairer_id, status);

create table public.claim_repair_notes (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims (id),
  repairer_id  uuid not null references public.repairers (id),
  side         text not null check (side in ('repairer', 'insurer')),
  author_id    uuid not null,
  author_email text,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index claim_repair_notes_idx on public.claim_repair_notes (claim_id, created_at);
create trigger claim_repair_notes_append_only before update or delete on public.claim_repair_notes
  for each row execute function private.forbid_mutation();

create table public.repair_files (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims (id),
  repairer_id  uuid not null references public.repairers (id),
  kind         text not null check (kind in ('photo', 'quote', 'invoice')),
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) <= 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  caption      text check (caption is null or char_length(caption) <= 200),
  uploaded_by  uuid not null,
  uploaded_at  timestamptz not null default now(),
  deleted_at   timestamptz
);
create index repair_files_claim_idx on public.repair_files (claim_id) where deleted_at is null;

-- ---- who is a repair person, and who may see a repair
create function private.repairer_member(p_repairer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.repairer_members m join public.repairers r on r.id = m.repairer_id
    where m.repairer_id = p_repairer and m.user_id = (select auth.uid()) and m.active and r.active)
$$;
create function private.my_claim_repairer(p_claim uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select cr.repairer_id from public.claim_repair cr where cr.claim_id = p_claim and private.repairer_member(cr.repairer_id)
$$;
create function private.repair_view_ok(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.claim_repair cr where cr.claim_id = p_claim)
     and (private.my_claim_repairer(p_claim) is not null
          or 'insurer' = any (private.claim_sides(p_claim))
          or 'fleet' = any (private.claim_sides(p_claim))
          or private.tpa_claim_ok(p_claim))
$$;
create function private.repairer_insurer(p_repairer uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select insurer_id from public.repairers where id = p_repairer
$$;
grant execute on function private.repairer_member(uuid), private.my_claim_repairer(uuid), private.repair_view_ok(uuid), private.repairer_insurer(uuid) to authenticated;

alter table public.repairers          enable row level security;
alter table public.repairer_members   enable row level security;
alter table public.claim_repair       enable row level security;
alter table public.claim_repair_notes enable row level security;
alter table public.repair_files       enable row level security;

create policy repairers_read on public.repairers for select to authenticated
  using (private.has_permission(insurer_id, 'claim.manage') or private.repairer_member(id));
create policy repairer_members_read on public.repairer_members for select to authenticated
  using (user_id = (select auth.uid()) or private.has_permission(private.repairer_insurer(repairer_id), 'membership.manage'));
create policy claim_repair_read on public.claim_repair for select to authenticated using (private.repair_view_ok(claim_id));
create policy claim_repair_notes_read on public.claim_repair_notes for select to authenticated using (private.repair_view_ok(claim_id));
create policy repair_files_read on public.repair_files for select to authenticated using (deleted_at is null and private.repair_view_ok(claim_id));

revoke all on public.repairers, public.repairer_members, public.claim_repair, public.claim_repair_notes, public.repair_files from anon;
revoke insert, update, delete, truncate on public.repairers, public.repairer_members, public.claim_repair, public.claim_repair_notes, public.repair_files from authenticated;
grant select on public.repairers, public.repairer_members, public.claim_repair, public.claim_repair_notes, public.repair_files to authenticated;

-- ---- private storage: path is <claim id>/<file>
create function private.repair_path(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' then split_part(p_name, '/', 1)::uuid end
$$;
create function private.can_upload_repair_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_claim_repairer(private.repair_path(p_name)) is not null
$$;
create function private.can_read_repair_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.repair_view_ok(private.repair_path(p_name))
$$;
create function private.can_delete_repair_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_upload_repair_file(p_name) and (
    exists (select 1 from public.repair_files f where f.storage_path = p_name and f.deleted_at is not null and f.uploaded_by = (select auth.uid()))
    or not exists (select 1 from public.repair_files f where f.storage_path = p_name))
$$;
grant execute on function private.repair_path(text), private.can_upload_repair_file(text), private.can_read_repair_file(text), private.can_delete_repair_file(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('repair-files', 'repair-files', false, 4194304, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy repair_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'repair-files' and private.can_upload_repair_file(name));
create policy repair_files_select on storage.objects for select to authenticated
  using (bucket_id = 'repair-files' and private.can_read_repair_file(name));
create policy repair_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'repair-files' and private.can_delete_repair_file(name));

-- ---- insurer: set up repairers and their people
create function public.create_repairer(p_insurer uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_name text := btrim(coalesce(p_name, '')); v_id uuid;
begin
  if p_insurer is null or not private.has_permission(p_insurer, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.organisations where id = p_insurer and kind = 'insurer') then raise exception 'insurer not found' using errcode = '22023'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'enter the repair shop''s name' using errcode = '22023'; end if;
  begin
    insert into public.repairers (insurer_id, name, created_by) values (p_insurer, v_name, v_user) returning id into v_id;
  exception when unique_violation then raise exception 'you already have a repair shop with that name' using errcode = '23505';
  end;
  perform private.write_audit(p_insurer, 'repairer.created', 'repairer', v_id, null, jsonb_build_object('name', v_name));
  return v_id;
end $$;

create function public.set_repairer_active(p_repairer uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.repairers;
begin
  perform private.require_user();
  select * into t from public.repairers where id = p_repairer;
  if not found or not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.repairers set active = coalesce(p_active, false) where id = t.id;
  perform private.write_audit(t.insurer_id, case when coalesce(p_active, false) then 'repairer.switched_on' else 'repairer.switched_off' end, 'repairer', t.id, null, jsonb_build_object('name', t.name));
end $$;

-- Returns 'added' or 'no_login' (the person has no sign-in yet: create one first, then call again).
create function public.add_repairer_member(p_repairer uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_user(); t public.repairers; v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid;
begin
  select * into t from public.repairers where id = p_repairer;
  if not found or not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'enter a valid email address' using errcode = '22023'; end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then return 'no_login'; end if;
  if v_user = v_actor then raise exception 'you cannot change your own access' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where user_id = v_user and active) or exists (select 1 from public.tpa_members where user_id = v_user and active) then
    raise exception 'that person already has access elsewhere; repair shop people use a separate login' using errcode = '22023';
  end if;
  insert into public.repairer_members (repairer_id, user_id, added_by) values (t.id, v_user, v_actor)
    on conflict (repairer_id, user_id) do update set active = true;
  perform private.write_audit(t.insurer_id, 'repairer.member_added', 'repairer', t.id, null, jsonb_build_object('email', v_email));
  return 'added';
end $$;

create function public.set_repairer_member_active(p_member uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.repairer_members; t public.repairers;
begin
  perform private.require_user();
  select * into m from public.repairer_members where id = p_member;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into t from public.repairers where id = m.repairer_id;
  if not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.repairer_members set active = coalesce(p_active, false) where id = m.id;
  perform private.write_audit(t.insurer_id, case when coalesce(p_active, false) then 'repairer.member_switched_on' else 'repairer.member_switched_off' end, 'repairer', t.id, null, jsonb_build_object('member', m.id));
end $$;

create function public.list_repairer_members(p_repairer uuid) returns table (id uuid, email text, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare t public.repairers;
begin
  perform private.require_user();
  select * into t from public.repairers where public.repairers.id = p_repairer;
  if not found or not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query select m.id, u.email::text, m.active, m.created_at
    from public.repairer_members m join auth.users u on u.id = m.user_id where m.repairer_id = t.id order by 2;
end $$;

-- ---- insurer: pass a claim to a repair shop, or take it back
create function public.assign_claim_repairer(p_claim uuid, p_repairer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_user uuid := private.require_user(); t public.repairers; v_old public.claim_repair; r record;
begin
  select * into v_old from public.claim_repair where claim_id = c.id;
  if p_repairer is null then
    if not found then return; end if;
    if v_old.status in ('approved', 'completed') then raise exception 'the repair has been approved, so it cannot be taken back' using errcode = '22023'; end if;
    delete from public.claim_repair where claim_id = c.id;
    perform private.write_audit(c.insurer_id, 'claim.repair_cleared', 'claim', c.id, jsonb_build_object('repairer_id', v_old.repairer_id), null);
    return;
  end if;
  if c.status = 'closed' then raise exception 'this claim is closed; reopen it first' using errcode = '22023'; end if;
  select * into t from public.repairers where id = p_repairer;
  if not found or t.insurer_id <> c.insurer_id or not t.active then raise exception 'choose one of your active repair shops' using errcode = '22023'; end if;
  if found and v_old.claim_id is not null then
    if v_old.repairer_id = t.id then raise exception 'this claim is already with that repair shop' using errcode = '22023'; end if;
    if v_old.status in ('approved', 'completed') then raise exception 'the repair has been approved, so it cannot be moved' using errcode = '22023'; end if;
    delete from public.claim_repair where claim_id = c.id;
  end if;
  insert into public.claim_repair (claim_id, repairer_id, insurer_id, fleet_id, assigned_by) values (c.id, t.id, c.insurer_id, c.fleet_id, v_user);
  for r in select m.user_id from public.repairer_members m where m.repairer_id = t.id and m.active loop
    perform private.notify(null, null, r.user_id, c.id, 'repair_assigned', 'A vehicle has been passed to you for repair', c.reference || ' · ' || c.registration);
  end loop;
  perform private.notify(c.fleet_id, 'claim.read', null, c.id, 'repair_assigned', 'Your vehicle has been passed to a repair shop', c.reference || ' · ' || t.name);
  perform private.write_audit(c.insurer_id, 'claim.repair_assigned', 'claim', c.id, null, jsonb_build_object('repairer_id', t.id));
end $$;

create function public.insurer_repair_note(p_claim uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_user uuid := private.require_user(); v_body text := btrim(coalesce(p_body, '')); cr public.claim_repair; r record;
begin
  select * into cr from public.claim_repair where claim_id = c.id;
  if not found then raise exception 'this claim is not with a repair shop' using errcode = '22023'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'write a note (up to 2,000 characters)' using errcode = '22023'; end if;
  insert into public.claim_repair_notes (claim_id, repairer_id, side, author_id, author_email, body)
    values (c.id, cr.repairer_id, 'insurer', v_user, (select email from auth.users where id = v_user), v_body);
  for r in select m.user_id from public.repairer_members m where m.repairer_id = cr.repairer_id and m.active loop
    perform private.notify(null, null, r.user_id, c.id, 'repair_note', 'Note from the insurer on ' || c.reference, left(v_body, 300));
  end loop;
end $$;

-- Approve the quote, or send it back for changes with a note.
create function public.decide_repair_quote(p_claim uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_user uuid := private.require_user(); v_note text := nullif(btrim(coalesce(p_note, '')), ''); cr public.claim_repair; r record;
begin
  select * into cr from public.claim_repair where claim_id = c.id for update;
  if not found then raise exception 'this claim is not with a repair shop' using errcode = '22023'; end if;
  if cr.status <> 'quote_submitted' then raise exception 'there is no quote waiting for a decision' using errcode = '22023'; end if;
  if p_decision not in ('approve', 'revise') then raise exception 'choose approve or send back' using errcode = '22023'; end if;
  if p_decision = 'revise' and v_note is null then raise exception 'say what needs to change' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'the note is too long' using errcode = '22023'; end if;
  if p_decision = 'approve' then
    update public.claim_repair set status = 'approved', decided_at = now(), decided_by = v_user, updated_at = now() where claim_id = c.id;
  else
    update public.claim_repair set status = 'with_repairer', updated_at = now() where claim_id = c.id;
  end if;
  if v_note is not null then
    insert into public.claim_repair_notes (claim_id, repairer_id, side, author_id, author_email, body)
      values (c.id, cr.repairer_id, 'insurer', v_user, (select email from auth.users where id = v_user), v_note);
  end if;
  for r in select m.user_id from public.repairer_members m where m.repairer_id = cr.repairer_id and m.active loop
    perform private.notify(null, null, r.user_id, c.id, 'repair_decision',
      case p_decision when 'approve' then 'Repair approved on ' else 'Quote sent back on ' end || c.reference, coalesce(left(v_note, 300), c.registration));
  end loop;
  if p_decision = 'approve' then
    perform private.notify(c.fleet_id, 'claim.read', null, c.id, 'repair_decision', 'The insurer has approved the repair on ' || c.reference, c.registration);
  end if;
  perform private.write_audit(c.insurer_id, case p_decision when 'approve' then 'claim.repair_approved' else 'claim.repair_sent_back' end, 'claim', c.id, null,
    jsonb_build_object('quote_amount', cr.quote_amount), v_note);
  return case p_decision when 'approve' then 'approved' else 'sent_back' end;
end $$;

-- ---- repair shop: what they can see, files, notes, quote, completion
-- Only what a repairer needs: the vehicle and the damage. Not the driver, injuries, police details or any insurer notes.
create function public.repairer_claims(p_claim uuid default null)
returns table (
  claim_id uuid, reference text, registration text, make_model text, incident_at timestamptz, location text, description text,
  vehicle_driveable boolean, fleet_name text, repair_status text, quote_amount numeric, quote_note text, assigned_at timestamptz, updated_at timestamptz, repairer_name text
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.reference, c.registration, v.make_model, c.incident_at, c.location, c.description, c.vehicle_driveable, o.name,
         cr.status, cr.quote_amount, cr.quote_note, cr.assigned_at, cr.updated_at, rp.name
    from public.claim_repair cr
    join public.claims c on c.id = cr.claim_id
    join public.repairers rp on rp.id = cr.repairer_id
    join public.organisations o on o.id = c.fleet_id
    left join public.vehicles v on v.id = c.vehicle_id
   where private.repairer_member(cr.repairer_id) and (p_claim is null or cr.claim_id = p_claim)
   order by cr.updated_at desc
$$;

create function public.repairer_note(p_claim uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_body text := btrim(coalesce(p_body, '')); v_rp uuid := private.my_claim_repairer(p_claim); c public.claims;
begin
  if v_rp is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into c from public.claims where id = p_claim;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'write a note (up to 2,000 characters)' using errcode = '22023'; end if;
  insert into public.claim_repair_notes (claim_id, repairer_id, side, author_id, author_email, body)
    values (p_claim, v_rp, 'repairer', v_user, (select email from auth.users where id = v_user), v_body);
  perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'repair_note', 'Repair shop note on ' || c.reference, left(v_body, 300));
end $$;

create function public.add_repair_file(p_claim uuid, p_kind text, p_path text, p_name text, p_type text, p_size integer, p_caption text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_rp uuid := private.my_claim_repairer(p_claim); cr public.claim_repair; v_id uuid;
begin
  if v_rp is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into cr from public.claim_repair where claim_id = p_claim for update;
  if p_kind not in ('photo', 'quote', 'invoice') then raise exception 'unknown file type' using errcode = '22023'; end if;
  if cr.status = 'completed' then raise exception 'this repair is complete' using errcode = '22023'; end if;
  if p_kind = 'quote' and cr.status <> 'with_repairer' then raise exception 'the quote has already been sent; the insurer must send it back before you change it' using errcode = '22023'; end if;
  if p_kind = 'invoice' and cr.status <> 'approved' then raise exception 'an invoice can be added once the repair is approved' using errcode = '22023'; end if;
  if p_path is null or p_path !~ ('^' || p_claim::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') then raise exception 'that file is not in this claim''s folder' using errcode = '42501'; end if;
  if p_kind in ('quote', 'invoice') and p_type <> 'application/pdf' and p_type not like 'image/%' then raise exception 'upload a PDF or a photo' using errcode = '22023'; end if;
  if (select count(*) from public.repair_files where claim_id = p_claim and deleted_at is null) >= 40 then raise exception 'this repair already has 40 files' using errcode = '22023'; end if;
  insert into public.repair_files (claim_id, repairer_id, kind, storage_path, file_name, content_type, size_bytes, caption, uploaded_by)
  values (p_claim, v_rp, p_kind, p_path, left(coalesce(p_name, 'file'), 200), p_type, p_size, nullif(left(btrim(coalesce(p_caption, '')), 200), ''), v_user)
  returning id into v_id;
  update public.claim_repair set updated_at = now() where claim_id = p_claim;
  return v_id;
end $$;

-- A shop person can remove their own file while the repair is open. Returns the storage path to delete.
create function public.remove_repair_file(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); f public.repair_files; cr public.claim_repair;
begin
  select * into f from public.repair_files where id = p_id and deleted_at is null for update;
  if not found or private.my_claim_repairer(f.claim_id) is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into cr from public.claim_repair where claim_id = f.claim_id;
  if cr.status in ('completed') or (f.kind = 'quote' and cr.status <> 'with_repairer') then raise exception 'this file can no longer be removed' using errcode = '22023'; end if;
  update public.repair_files set deleted_at = now() where id = f.id;
  update public.claim_repair set updated_at = now() where claim_id = f.claim_id;
  return f.storage_path;
end $$;

create function public.submit_repair_quote(p_claim uuid, p_amount numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_rp uuid := private.my_claim_repairer(p_claim); cr public.claim_repair; c public.claims; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_rp is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into cr from public.claim_repair where claim_id = p_claim for update;
  select * into c from public.claims where id = p_claim;
  if cr.status <> 'with_repairer' then raise exception 'the quote has already been sent' using errcode = '22023'; end if;
  if c.status = 'closed' then raise exception 'this claim is closed' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'enter the quote total' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'the note is too long' using errcode = '22023'; end if;
  if not exists (select 1 from public.repair_files where claim_id = p_claim and kind = 'quote' and deleted_at is null) then raise exception 'upload the quote document first' using errcode = '22023'; end if;
  if not exists (select 1 from public.repair_files where claim_id = p_claim and kind = 'photo' and deleted_at is null) then raise exception 'add at least one photo of the damage first' using errcode = '22023'; end if;
  update public.claim_repair set status = 'quote_submitted', quote_amount = round(p_amount, 2), quote_note = v_note, quote_submitted_at = now(), quote_submitted_by = v_user, updated_at = now() where claim_id = p_claim;
  perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'repair_quote', 'Repair quote to approve on ' || c.reference, c.registration || ' · £' || to_char(round(p_amount, 2), 'FM999,999,990.00'));
end $$;

create function public.complete_repair(p_claim uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_rp uuid := private.my_claim_repairer(p_claim); cr public.claim_repair; c public.claims; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_rp is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into cr from public.claim_repair where claim_id = p_claim for update;
  select * into c from public.claims where id = p_claim;
  if cr.status <> 'approved' then raise exception 'the repair has not been approved yet' using errcode = '22023'; end if;
  update public.claim_repair set status = 'completed', completed_at = now(), updated_at = now() where claim_id = p_claim;
  if v_note is not null then
    insert into public.claim_repair_notes (claim_id, repairer_id, side, author_id, author_email, body)
      values (p_claim, v_rp, 'repairer', v_user, (select email from auth.users where id = v_user), left(v_note, 2000));
  end if;
  perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'repair_complete', 'Repair completed on ' || c.reference, c.registration);
  perform private.notify(c.fleet_id, 'claim.read', null, c.id, 'repair_complete', 'Your vehicle repair is complete', c.reference || ' · ' || c.registration);
end $$;

-- Opening a repair file by someone other than the uploader is written to the audit trail.
create function public.log_repair_file_view(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.repair_files; v_user uuid := private.require_user(); v_ins uuid;
begin
  select * into f from public.repair_files where id = p_id and deleted_at is null;
  if not found or not private.repair_view_ok(f.claim_id) then raise exception 'file not found' using errcode = '42501'; end if;
  if f.uploaded_by = v_user then return; end if;
  select insurer_id into v_ins from public.claims where id = f.claim_id;
  perform private.write_audit(v_ins, 'claim.repair_file_viewed', 'claim', f.claim_id, null, jsonb_build_object('file', f.id));
end $$;

revoke all on function public.create_repairer(uuid, text), public.set_repairer_active(uuid, boolean), public.add_repairer_member(uuid, text),
  public.set_repairer_member_active(uuid, boolean), public.list_repairer_members(uuid), public.assign_claim_repairer(uuid, uuid),
  public.insurer_repair_note(uuid, text), public.decide_repair_quote(uuid, text, text), public.repairer_claims(uuid), public.repairer_note(uuid, text),
  public.add_repair_file(uuid, text, text, text, text, integer, text), public.remove_repair_file(uuid), public.submit_repair_quote(uuid, numeric, text),
  public.complete_repair(uuid, text), public.log_repair_file_view(uuid) from public, anon;
grant execute on function public.create_repairer(uuid, text), public.set_repairer_active(uuid, boolean), public.add_repairer_member(uuid, text),
  public.set_repairer_member_active(uuid, boolean), public.list_repairer_members(uuid), public.assign_claim_repairer(uuid, uuid),
  public.insurer_repair_note(uuid, text), public.decide_repair_quote(uuid, text, text), public.repairer_claims(uuid), public.repairer_note(uuid, text),
  public.add_repair_file(uuid, text, text, text, text, integer, text), public.remove_repair_file(uuid), public.submit_repair_quote(uuid, numeric, text),
  public.complete_repair(uuid, text), public.log_repair_file_view(uuid) to authenticated;
