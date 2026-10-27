-- TPA access to claims.
-- An insurer can set up several third-party administrators (TPAs), add their staff, and route individual claims to one of them.
-- A TPA works with the INSURER only: it can read the claim it has been given, add notes for the insurer and record a recommendation.
-- It cannot write to the fleet, ask the fleet for anything, upload or remove files, close a claim or see anything else. The insurer keeps
-- the final decision: closing a claim stays an insurer action. TPA people have no memberships, so no existing policy ever matches them;
-- the additive read policies below are the only way in, and they only match a claim currently routed to a TPA the person belongs to.
-- TPA activity is audited under the INSURER organisation, so the fleet never sees that a TPA exists.

create table public.tpas (
  id         uuid primary key default gen_random_uuid(),
  insurer_id uuid not null references public.organisations (id),
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index tpas_name_per_insurer on public.tpas (insurer_id, lower(btrim(name)));
create index tpas_insurer_idx on public.tpas (insurer_id);

create function private.check_tpa_insurer() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.organisations o where o.id = new.insurer_id and o.kind = 'insurer') then
    raise exception 'a TPA belongs to an insurer organisation' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger tpas_check_insurer before insert or update of insurer_id on public.tpas
  for each row execute function private.check_tpa_insurer();

create table public.tpa_members (
  id         uuid primary key default gen_random_uuid(),
  tpa_id     uuid not null references public.tpas (id),
  user_id    uuid not null references auth.users (id) on delete cascade,
  active     boolean not null default true,
  added_by   uuid,
  created_at timestamptz not null default now(),
  unique (tpa_id, user_id)
);
create index tpa_members_user_idx on public.tpa_members (user_id) where active;

-- One TPA at a time per claim. Deleted when the insurer takes the claim back.
create table public.claim_tpa (
  claim_id            uuid primary key references public.claims (id),
  tpa_id              uuid not null references public.tpas (id),
  insurer_id          uuid not null references public.organisations (id),
  assigned_by         uuid,
  assigned_at         timestamptz not null default now(),
  first_touched_at    timestamptz,
  recommendation      text check (recommendation in ('settle', 'decline', 'more_information', 'other')),
  recommendation_note text check (recommendation_note is null or char_length(recommendation_note) <= 2000),
  recommended_by      uuid,
  recommended_at      timestamptz,
  check ((recommendation is null) = (recommended_at is null))
);
create index claim_tpa_tpa_idx on public.claim_tpa (tpa_id);

-- The conversation between the insurer and the TPA. Never visible to the fleet or the driver. Append-only.
create table public.claim_tpa_notes (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims (id),
  tpa_id       uuid not null references public.tpas (id),
  side         text not null check (side in ('tpa', 'insurer')),
  author_id    uuid not null,
  author_email text,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index claim_tpa_notes_claim_idx on public.claim_tpa_notes (claim_id, created_at);
create trigger claim_tpa_notes_append_only before update or delete on public.claim_tpa_notes
  for each row execute function private.forbid_mutation();

-- ---- who is a TPA person, and which claims they may see
create function private.tpa_member(p_tpa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tpa_members m join public.tpas t on t.id = m.tpa_id
    where m.tpa_id = p_tpa and m.user_id = (select auth.uid()) and m.active and t.active)
$$;
create function private.my_claim_tpa(p_claim uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select ct.tpa_id from public.claim_tpa ct where ct.claim_id = p_claim and private.tpa_member(ct.tpa_id)
$$;
create function private.tpa_claim_ok(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_claim_tpa(p_claim) is not null
$$;
create function private.tpa_claim(p_claim uuid) returns public.claims
language plpgsql security definer set search_path = '' as $$
declare c public.claims;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or private.my_claim_tpa(p_claim) is null then raise exception 'permission denied' using errcode = '42501'; end if;
  return c;
end $$;
create function private.tpa_insurer(p_tpa uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select insurer_id from public.tpas where id = p_tpa
$$;
grant execute on function private.tpa_member(uuid), private.my_claim_tpa(uuid), private.tpa_claim_ok(uuid), private.tpa_insurer(uuid) to authenticated;
revoke all on function private.tpa_claim(uuid) from public, anon, authenticated;

alter table public.tpas            enable row level security;
alter table public.tpa_members     enable row level security;
alter table public.claim_tpa       enable row level security;
alter table public.claim_tpa_notes enable row level security;

create policy tpas_read on public.tpas for select to authenticated
  using (private.has_permission(insurer_id, 'claim.manage') or private.tpa_member(id));
create policy tpa_members_read on public.tpa_members for select to authenticated
  using (user_id = (select auth.uid()) or private.has_permission(private.tpa_insurer(tpa_id), 'membership.manage'));
create policy claim_tpa_read on public.claim_tpa for select to authenticated
  using ('insurer' = any (private.claim_sides(claim_id)) or private.tpa_member(tpa_id));
create policy claim_tpa_notes_read on public.claim_tpa_notes for select to authenticated
  using ('insurer' = any (private.claim_sides(claim_id)) or tpa_id = private.my_claim_tpa(claim_id));

revoke all on public.tpas, public.tpa_members, public.claim_tpa, public.claim_tpa_notes from anon;
revoke insert, update, delete, truncate on public.tpas, public.tpa_members, public.claim_tpa, public.claim_tpa_notes from authenticated;
grant select on public.tpas, public.tpa_members, public.claim_tpa, public.claim_tpa_notes to authenticated;

-- A TPA person can read the claim routed to them and what hangs off it. Not the insurer's private notes, not the handler, not CUE.
create policy claims_tpa_read on public.claims for select to authenticated using (private.tpa_claim_ok(id));
create policy claim_parties_tpa_read on public.claim_parties for select to authenticated
  using (deleted_at is null and private.tpa_claim_ok(claim_id));
create policy claim_requests_tpa_read on public.claim_requests for select to authenticated using (private.tpa_claim_ok(claim_id));
create policy claim_request_items_tpa_read on public.claim_request_items for select to authenticated using (private.tpa_claim_ok(claim_id));
create policy claim_attachments_tpa_read on public.claim_attachments for select to authenticated
  using (deleted_at is null and private.tpa_claim_ok(claim_id));
create policy claim_events_tpa_read on public.claim_events for select to authenticated
  using (visibility = 'shared' and private.tpa_claim_ok(claim_id));

-- Files: the storage rule and the audit entry for opening one now also understand TPA people.
create or replace function private.can_read_claim_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.claim_file_fleet_ok(p_name)
    and (cardinality(private.claim_sides(private.claim_path(p_name))) > 0 or private.tpa_claim_ok(private.claim_path(p_name)))
$$;
create or replace function public.log_claim_file_view(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.claim_attachments; v_user uuid := private.require_user(); v_tpa boolean; v_ins uuid;
begin
  select * into a from public.claim_attachments where id = p_id and deleted_at is null;
  if not found then raise exception 'file not found' using errcode = '42501'; end if;
  v_tpa := cardinality(private.claim_sides(a.claim_id)) = 0 and private.tpa_claim_ok(a.claim_id);
  if cardinality(private.claim_sides(a.claim_id)) = 0 and not v_tpa then raise exception 'file not found' using errcode = '42501'; end if;
  if a.uploaded_by = v_user then return; end if;
  if v_tpa then
    select insurer_id into v_ins from public.claims where id = a.claim_id;
    perform private.write_audit(v_ins, 'claim.file_viewed_by_tpa', 'claim', a.claim_id, null, jsonb_build_object('attachment', a.id));
  else
    perform private.write_audit(a.fleet_id, 'claim.file_viewed', 'claim', a.claim_id, null, jsonb_build_object('attachment', a.id));
  end if;
end $$;

-- ---- insurer: set up TPAs and their people
create function public.create_tpa(p_insurer uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_name text := btrim(coalesce(p_name, '')); v_id uuid;
begin
  if p_insurer is null or not private.has_permission(p_insurer, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.organisations where id = p_insurer and kind = 'insurer') then raise exception 'insurer not found' using errcode = '22023'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'enter the TPA''s name' using errcode = '22023'; end if;
  begin
    insert into public.tpas (insurer_id, name, created_by) values (p_insurer, v_name, v_user) returning id into v_id;
  exception when unique_violation then
    raise exception 'you already have a TPA with that name' using errcode = '23505';
  end;
  perform private.write_audit(p_insurer, 'tpa.created', 'tpa', v_id, null, jsonb_build_object('name', v_name));
  return v_id;
end $$;

create function public.set_tpa_active(p_tpa uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tpas;
begin
  perform private.require_user();
  select * into t from public.tpas where id = p_tpa;
  if not found or not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.tpas set active = coalesce(p_active, false) where id = t.id;
  perform private.write_audit(t.insurer_id, case when coalesce(p_active, false) then 'tpa.switched_on' else 'tpa.switched_off' end, 'tpa', t.id, null, jsonb_build_object('name', t.name));
end $$;

-- Returns 'added' or 'no_login' (the person has no sign-in yet: create one first, then call again).
create function public.add_tpa_member(p_tpa uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_user(); t public.tpas; v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid; v_id uuid;
begin
  select * into t from public.tpas where id = p_tpa;
  if not found or not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'enter a valid email address' using errcode = '22023'; end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then return 'no_login'; end if;
  if v_user = v_actor then raise exception 'you cannot change your own access' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where user_id = v_user and active) then
    raise exception 'that person already has access to an organisation; TPA people use a separate login' using errcode = '22023';
  end if;
  insert into public.tpa_members (tpa_id, user_id, added_by) values (t.id, v_user, v_actor)
    on conflict (tpa_id, user_id) do update set active = true returning id into v_id;
  perform private.write_audit(t.insurer_id, 'tpa.member_added', 'tpa', t.id, null, jsonb_build_object('email', v_email));
  return 'added';
end $$;

create function public.set_tpa_member_active(p_member uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.tpa_members; t public.tpas;
begin
  perform private.require_user();
  select * into m from public.tpa_members where id = p_member;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into t from public.tpas where id = m.tpa_id;
  if not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.tpa_members set active = coalesce(p_active, false) where id = m.id;
  perform private.write_audit(t.insurer_id, case when coalesce(p_active, false) then 'tpa.member_switched_on' else 'tpa.member_switched_off' end, 'tpa', t.id, null, jsonb_build_object('member', m.id));
end $$;

create function public.list_tpa_members(p_tpa uuid) returns table (id uuid, email text, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare t public.tpas;
begin
  perform private.require_user();
  select * into t from public.tpas where public.tpas.id = p_tpa;
  if not found or not private.has_permission(t.insurer_id, 'membership.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query select m.id, u.email::text, m.active, m.created_at
    from public.tpa_members m join auth.users u on u.id = m.user_id where m.tpa_id = t.id order by 2;
end $$;

-- ---- insurer: route a claim to a TPA, or take it back
create function public.assign_claim_tpa(p_claim uuid, p_tpa uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_user uuid := private.require_user(); t public.tpas; v_old uuid; r record;
begin
  select tpa_id into v_old from public.claim_tpa where claim_id = c.id;
  if p_tpa is null then
    if v_old is null then return; end if;
    delete from public.claim_tpa where claim_id = c.id;
    perform private.claim_event(c, 'tpa_assigned', 'insurer', 'insurer', 'Taken back from the TPA.');
    perform private.write_audit(c.insurer_id, 'claim.tpa_cleared', 'claim', c.id, jsonb_build_object('tpa_id', v_old), null);
    return;
  end if;
  if c.status = 'closed' then raise exception 'this claim is closed; reopen it first' using errcode = '22023'; end if;
  select * into t from public.tpas where id = p_tpa;
  if not found or t.insurer_id <> c.insurer_id or not t.active then raise exception 'choose one of your active TPAs' using errcode = '22023'; end if;
  if v_old = t.id then raise exception 'this claim is already with that TPA' using errcode = '22023'; end if;
  delete from public.claim_tpa where claim_id = c.id;
  insert into public.claim_tpa (claim_id, tpa_id, insurer_id, assigned_by) values (c.id, t.id, c.insurer_id, v_user);
  perform private.claim_event(c, 'tpa_assigned', 'insurer', 'insurer', 'Routed to ' || t.name || '.');
  for r in select m.user_id from public.tpa_members m where m.tpa_id = t.id and m.active loop
    perform private.notify(null, null, r.user_id, c.id, 'tpa_assigned', 'A claim has been routed to you', c.reference || ' · ' || c.registration);
  end loop;
  perform private.write_audit(c.insurer_id, 'claim.tpa_assigned', 'claim', c.id, jsonb_build_object('tpa_id', v_old), jsonb_build_object('tpa_id', t.id));
end $$;

create function public.insurer_tpa_note(p_claim uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims := private.insurer_claim(p_claim); v_user uuid := private.require_user(); v_body text := btrim(coalesce(p_body, '')); ct public.claim_tpa; r record;
begin
  select * into ct from public.claim_tpa where claim_id = c.id;
  if not found then raise exception 'this claim is not with a TPA' using errcode = '22023'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then raise exception 'write a note (up to 4,000 characters)' using errcode = '22023'; end if;
  insert into public.claim_tpa_notes (claim_id, tpa_id, side, author_id, author_email, body)
    values (c.id, ct.tpa_id, 'insurer', v_user, (select email from auth.users where id = v_user), v_body);
  for r in select m.user_id from public.tpa_members m where m.tpa_id = ct.tpa_id and m.active loop
    perform private.notify(null, null, r.user_id, c.id, 'tpa_note', 'Note from the insurer on ' || c.reference, left(v_body, 300));
  end loop;
  perform private.write_audit(c.insurer_id, 'claim.tpa_note', 'claim', c.id, null, jsonb_build_object('side', 'insurer'));
end $$;

-- ---- TPA: notes and a recommendation, for the insurer only
create function public.tpa_add_note(p_claim uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims; v_user uuid := private.require_user(); v_body text := btrim(coalesce(p_body, '')); v_tpa uuid;
begin
  c := private.tpa_claim(p_claim);
  v_tpa := private.my_claim_tpa(c.id);
  if c.status = 'closed' then raise exception 'this claim is closed' using errcode = '22023'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then raise exception 'write a note (up to 4,000 characters)' using errcode = '22023'; end if;
  insert into public.claim_tpa_notes (claim_id, tpa_id, side, author_id, author_email, body)
    values (c.id, v_tpa, 'tpa', v_user, (select email from auth.users where id = v_user), v_body);
  update public.claim_tpa set first_touched_at = coalesce(first_touched_at, now()) where claim_id = c.id;
  perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'tpa_note', 'TPA note on ' || c.reference, left(v_body, 300));
  perform private.write_audit(c.insurer_id, 'claim.tpa_note', 'claim', c.id, null, jsonb_build_object('side', 'tpa'));
end $$;

create function public.tpa_recommend(p_claim uuid, p_recommendation text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims; v_user uuid := private.require_user(); v_note text := btrim(coalesce(p_note, '')); v_tpa uuid;
begin
  c := private.tpa_claim(p_claim);
  v_tpa := private.my_claim_tpa(c.id);
  if c.status = 'closed' then raise exception 'this claim is closed' using errcode = '22023'; end if;
  if p_recommendation is null or p_recommendation not in ('settle', 'decline', 'more_information', 'other') then raise exception 'choose a recommendation' using errcode = '22023'; end if;
  if char_length(v_note) < 3 or char_length(v_note) > 2000 then raise exception 'explain the recommendation (3 to 2,000 characters)' using errcode = '22023'; end if;
  update public.claim_tpa set recommendation = p_recommendation, recommendation_note = v_note, recommended_by = v_user, recommended_at = now(),
    first_touched_at = coalesce(first_touched_at, now()) where claim_id = c.id;
  insert into public.claim_tpa_notes (claim_id, tpa_id, side, author_id, author_email, body)
    values (c.id, v_tpa, 'tpa', v_user, (select email from auth.users where id = v_user),
      'Recommendation: ' || case p_recommendation when 'settle' then 'settle' when 'decline' then 'decline' when 'more_information' then 'more information needed' else 'other' end || '. ' || v_note);
  perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'tpa_recommendation', 'TPA recommendation on ' || c.reference, left(v_note, 300));
  perform private.write_audit(c.insurer_id, 'claim.tpa_recommended', 'claim', c.id, null, jsonb_build_object('recommendation', p_recommendation));
end $$;

revoke all on function public.create_tpa(uuid, text), public.set_tpa_active(uuid, boolean), public.add_tpa_member(uuid, text),
  public.set_tpa_member_active(uuid, boolean), public.list_tpa_members(uuid), public.assign_claim_tpa(uuid, uuid),
  public.insurer_tpa_note(uuid, text), public.tpa_add_note(uuid, text), public.tpa_recommend(uuid, text, text) from public, anon;
grant execute on function public.create_tpa(uuid, text), public.set_tpa_active(uuid, boolean), public.add_tpa_member(uuid, text),
  public.set_tpa_member_active(uuid, boolean), public.list_tpa_members(uuid), public.assign_claim_tpa(uuid, uuid),
  public.insurer_tpa_note(uuid, text), public.tpa_add_note(uuid, text), public.tpa_recommend(uuid, text, text) to authenticated;
