-- Stratify: user management. Who may add, change or switch off members of an organisation.
-- Rules (DEVELOPMENT ASSUMPTIONS, to be reviewed):
--   * Anyone holding membership.manage can manage members of their own organisation and, for an insurer,
--     of its fleet customers. Platform administrators can manage everyone.
--   * insurer_admin and fleet_admin now hold membership.manage; other roles do not.
--   * Nobody can change or switch off their own membership (prevents self-escalation and lock-out).
--   * An organisation can never be left without an active administrator.
--   * A role must suit the organisation kind (existing trigger), so an insurer can never create a platform admin.
--   * People who do not have a sign-in yet are held as invitations and become members automatically the
--     first time they sign in with that CONFIRMED email address. No emails are sent by this migration.

update public.permissions set description = 'Add, change and switch off members of organisations you administer' where code = 'membership.manage';
insert into public.role_permissions (role, permission) values
  ('insurer_admin', 'membership.manage'), ('fleet_admin', 'membership.manage')
on conflict do nothing;

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  email           text not null check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role            public.app_role not null,
  invited_by      uuid,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  claimed_by      uuid,
  revoked_at      timestamptz
);
create unique index invitations_one_pending on public.invitations (organisation_id, email) where claimed_at is null and revoked_at is null;
create trigger invitations_check_role before insert or update on public.invitations
  for each row execute function private.check_membership_role();

alter table public.invitations enable row level security;
create policy invitations_read on public.invitations for select to authenticated
  using (organisation_id in (select private.accessible_orgs('membership.manage')));
revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;

-- The administrator role of each kind of organisation.
create function private.admin_role_for(p_org uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select case o.kind when 'platform' then 'platform_super_admin' when 'insurer' then 'insurer_admin' else 'fleet_admin' end::public.app_role
  from public.organisations o where o.id = p_org
$$;

create function private.would_orphan_admin(p_membership public.memberships, p_new_role public.app_role, p_new_active boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_membership.active and p_membership.role = private.admin_role_for(p_membership.organisation_id)
     and (p_new_role <> p_membership.role or not p_new_active)
     and not exists (
       select 1 from public.memberships m
       where m.organisation_id = p_membership.organisation_id and m.active and m.id <> p_membership.id
         and m.role = private.admin_role_for(p_membership.organisation_id))
$$;

-- List members (and pending invitations) of an organisation, with their sign-in email.
create function public.list_members(p_org uuid)
returns table (id uuid, user_id uuid, email text, full_name text, role public.app_role, active boolean, pending boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission(p_org, 'membership.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, u.email::text, p.full_name, m.role, m.active, false, m.created_at
      from public.memberships m
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
     where m.organisation_id = p_org
    union all
    select i.id, null::uuid, i.email, null::text, i.role, true, true, i.created_at
      from public.invitations i
     where i.organisation_id = p_org and i.claimed_at is null and i.revoked_at is null
    order by 8 desc;
end $$;

-- Add a member by email. Existing sign-ins are added at once; others become a pending invitation.
create function public.add_member(p_org uuid, p_email text, p_role public.app_role) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_user();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid; v_existing public.memberships; v_id uuid;
begin
  if not private.has_permission(p_org, 'membership.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null and v_user = v_actor then
    raise exception 'you cannot change your own access' using errcode = '42501';
  end if;
  if v_user is not null then
    select * into v_existing from public.memberships where user_id = v_user and organisation_id = p_org;
    if found and v_existing.active then
      raise exception 'that person is already a member; change their role instead' using errcode = '23505';
    end if;
    if found then
      update public.memberships set role = p_role, active = true where id = v_existing.id;
    else
      insert into public.memberships (user_id, organisation_id, role) values (v_user, p_org, p_role);
    end if;
    return 'added';
  end if;
  begin
    insert into public.invitations (organisation_id, email, role, invited_by) values (p_org, v_email, p_role, v_actor) returning id into v_id;
  exception when unique_violation then
    raise exception 'that email already has a pending invitation' using errcode = '23505';
  end;
  perform private.write_audit(p_org, 'invitation.created', 'invitation', v_id, null,
    jsonb_build_object('email', v_email, 'role', p_role));
  return 'invited';
end $$;

create function public.change_member_role(p_membership uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_user(); v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if not found or not private.has_permission(v_m.organisation_id, 'membership.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_m.user_id = v_actor then raise exception 'you cannot change your own access' using errcode = '42501'; end if;
  if private.would_orphan_admin(v_m, p_role, v_m.active) then
    raise exception 'an organisation must keep at least one active administrator' using errcode = '23514';
  end if;
  update public.memberships set role = p_role where id = p_membership;
end $$;

create function public.set_member_active(p_membership uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_user(); v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if not found or not private.has_permission(v_m.organisation_id, 'membership.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_m.user_id = v_actor then raise exception 'you cannot change your own access' using errcode = '42501'; end if;
  if private.would_orphan_admin(v_m, v_m.role, p_active) then
    raise exception 'an organisation must keep at least one active administrator' using errcode = '23514';
  end if;
  update public.memberships set active = p_active where id = p_membership;
end $$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_i public.invitations;
begin
  perform private.require_user();
  select * into v_i from public.invitations where id = p_invitation and claimed_at is null and revoked_at is null;
  if not found or not private.has_permission(v_i.organisation_id, 'membership.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now() where id = p_invitation;
  perform private.write_audit(v_i.organisation_id, 'invitation.revoked', 'invitation', v_i.id, to_jsonb(v_i), null);
end $$;

-- Called at sign-in: turns pending invitations for the caller's CONFIRMED email into memberships.
create function public.claim_invitations() returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_email text; v_n int := 0; r public.invitations;
begin
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for r in select * from public.invitations where email = v_email and claimed_at is null and revoked_at is null for update loop
    insert into public.memberships (user_id, organisation_id, role) values (v_uid, r.organisation_id, r.role)
      on conflict (user_id, organisation_id) do nothing;
    update public.invitations set claimed_at = now(), claimed_by = v_uid where id = r.id;
    perform private.write_audit(r.organisation_id, 'invitation.claimed', 'invitation', r.id, null, jsonb_build_object('email', v_email, 'role', r.role));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.list_members(uuid), public.add_member(uuid, text, public.app_role),
  public.change_member_role(uuid, public.app_role), public.set_member_active(uuid, boolean),
  public.revoke_invitation(uuid), public.claim_invitations() from public, anon;
grant execute on function public.list_members(uuid), public.add_member(uuid, text, public.app_role),
  public.change_member_role(uuid, public.app_role), public.set_member_active(uuid, boolean),
  public.revoke_invitation(uuid), public.claim_invitations() to authenticated;
revoke all on function private.admin_role_for(uuid), private.would_orphan_admin(public.memberships, public.app_role, boolean) from public, anon, authenticated;
