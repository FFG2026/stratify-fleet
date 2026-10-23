create schema if not exists private;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.org_kind as enum ('platform', 'insurer', 'fleet');

create type public.app_role as enum (
  'platform_super_admin',
  'insurer_admin', 'insurer_claims', 'insurer_accounts',
  'fleet_admin', 'fleet_manager', 'fleet_accounts',
  'driver'
);

create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  kind        public.org_kind not null,
  name        text not null check (length(btrim(name)) > 0),
  insurer_id  uuid references public.organisations (id),
  created_at  timestamptz not null default now(),
  constraint organisations_insurer_link check (
    (kind = 'fleet' and insurer_id is not null) or (kind <> 'fleet' and insurer_id is null)
  )
);
create unique index organisations_one_platform on public.organisations (kind) where kind = 'platform';
create index organisations_insurer_idx on public.organisations (insurer_id) where insurer_id is not null;

create function private.check_org_insurer() returns trigger
language plpgsql as $$
begin
  if new.kind = 'fleet' and not exists (
    select 1 from public.organisations i where i.id = new.insurer_id and i.kind = 'insurer'
  ) then
    raise exception 'fleet.insurer_id must reference an insurer organisation' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger organisations_check_insurer before insert or update on public.organisations
  for each row execute function private.check_org_insurer();

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  role            public.app_role not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (user_id, organisation_id)
);
create index memberships_user_idx on public.memberships (user_id) where active;

create function private.check_membership_role() returns trigger
language plpgsql as $$
declare v_kind public.org_kind;
begin
  select kind into v_kind from public.organisations where id = new.organisation_id;
  if (new.role = 'platform_super_admin' and v_kind <> 'platform')
     or (new.role in ('insurer_admin','insurer_claims','insurer_accounts') and v_kind <> 'insurer')
     or (new.role in ('fleet_admin','fleet_manager','fleet_accounts','driver') and v_kind <> 'fleet') then
    raise exception 'role % is not valid for a % organisation', new.role, v_kind using errcode = '23514';
  end if;
  return new;
end $$;
create trigger memberships_check_role before insert or update on public.memberships
  for each row execute function private.check_membership_role();

create table public.permissions (
  code        text primary key,
  description text not null
);
create table public.role_permissions (
  role       public.app_role not null,
  permission text not null references public.permissions (code),
  primary key (role, permission)
);

insert into public.permissions (code, description) values
  ('fleet.read',             'See fleet customer organisations'),
  ('vehicle.read',           'See vehicles'),
  ('policy.read',            'See policies'),
  ('coverage.read',          'See coverage periods and events'),
  ('coverage.add',           'Put a vehicle on cover'),
  ('coverage.remove',        'Take a vehicle off cover'),
  ('coverage.backdate',      'Make coverage changes effective before today (no approval workflow yet)'),
  ('coverage.correct',       'Void an incorrect coverage period (leaves a trace)'),
  ('reconciliation.read',    'See reconciliation reports'),
  ('reconciliation.generate','Generate a reconciliation report'),
  ('rates.read',             'See rate cards and billing rules'),
  ('rates.manage',           'Add rate cards and billing rules (append-only)'),
  ('audit.read',             'See the audit log'),
  ('mipd.read',              'See MID submission status records'),
  ('membership.manage',      'Manage organisation memberships (UI not built yet)');

insert into public.role_permissions (role, permission)
select 'platform_super_admin', code from public.permissions;

insert into public.role_permissions (role, permission) values
  ('insurer_admin','fleet.read'),('insurer_admin','vehicle.read'),('insurer_admin','policy.read'),
  ('insurer_admin','coverage.read'),('insurer_admin','coverage.add'),('insurer_admin','coverage.remove'),
  ('insurer_admin','coverage.backdate'),('insurer_admin','coverage.correct'),
  ('insurer_admin','reconciliation.read'),('insurer_admin','reconciliation.generate'),
  ('insurer_admin','rates.read'),('insurer_admin','rates.manage'),
  ('insurer_admin','audit.read'),('insurer_admin','mipd.read'),
  ('insurer_claims','fleet.read'),('insurer_claims','vehicle.read'),('insurer_claims','policy.read'),('insurer_claims','coverage.read'),
  ('insurer_accounts','fleet.read'),('insurer_accounts','vehicle.read'),('insurer_accounts','policy.read'),('insurer_accounts','coverage.read'),
  ('insurer_accounts','reconciliation.read'),('insurer_accounts','reconciliation.generate'),('insurer_accounts','rates.read'),
  ('fleet_admin','fleet.read'),('fleet_admin','vehicle.read'),('fleet_admin','policy.read'),('fleet_admin','coverage.read'),
  ('fleet_admin','coverage.add'),('fleet_admin','coverage.remove'),
  ('fleet_admin','reconciliation.read'),('fleet_admin','reconciliation.generate'),('fleet_admin','audit.read'),('fleet_admin','mipd.read'),
  ('fleet_manager','fleet.read'),('fleet_manager','vehicle.read'),('fleet_manager','policy.read'),('fleet_manager','coverage.read'),
  ('fleet_manager','coverage.add'),('fleet_manager','coverage.remove'),
  ('fleet_accounts','fleet.read'),('fleet_accounts','vehicle.read'),('fleet_accounts','policy.read'),('fleet_accounts','coverage.read'),
  ('fleet_accounts','reconciliation.read'),('fleet_accounts','reconciliation.generate');

create function private.accessible_orgs(p_perm text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id
  from public.organisations o
  where exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role and rp.permission = p_perm
    join public.organisations mo on mo.id = m.organisation_id
    where m.user_id = (select auth.uid())
      and m.active
      and (
        o.id = m.organisation_id
        or (mo.kind = 'insurer' and o.insurer_id = mo.id)
        or mo.kind = 'platform'
      )
  )
$$;

create function private.has_permission(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is not null and p_org in (select private.accessible_orgs(p_perm))
$$;

create function private.my_orgs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select organisation_id from public.memberships where user_id = (select auth.uid()) and active
$$;

create table public.audit_logs (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,
  actor_kind      text not null check (actor_kind in ('user', 'system')),
  organisation_id uuid not null references public.organisations (id),
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  before_state    jsonb,
  after_state     jsonb,
  note            text
);
create index audit_logs_org_time_idx on public.audit_logs (organisation_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create function private.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not permitted', tg_table_name, tg_op using errcode = '55000';
end $$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.forbid_mutation();

create function private.write_audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_before jsonb, p_after jsonb, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  insert into public.audit_logs (actor_id, actor_kind, organisation_id, action, entity_type, entity_id, before_state, after_state, note)
  values (v_actor, case when v_actor is null then 'system' else 'user' end, p_org, p_action, p_entity_type, p_entity_id, p_before, p_after, p_note);
end $$;

create function private.audit_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organisation_id, 'membership.created', 'membership', new.id, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    perform private.write_audit(new.organisation_id, 'membership.updated', 'membership', new.id, to_jsonb(old), to_jsonb(new));
  else
    perform private.write_audit(old.organisation_id, 'membership.deleted', 'membership', old.id, to_jsonb(old), null);
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.audit_membership();

alter table public.organisations     enable row level security;
alter table public.profiles          enable row level security;
alter table public.memberships       enable row level security;
alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.audit_logs        enable row level security;

create policy organisations_read on public.organisations for select to authenticated
  using (id in (select private.accessible_orgs('fleet.read')) or id in (select private.my_orgs()));
create policy profiles_read_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or organisation_id in (select private.accessible_orgs('membership.manage')));
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (organisation_id in (select private.accessible_orgs('audit.read')));

revoke all on public.organisations, public.profiles, public.memberships, public.permissions,
              public.role_permissions, public.audit_logs from anon, authenticated;
grant select on public.organisations, public.profiles, public.memberships, public.permissions,
                public.role_permissions, public.audit_logs to authenticated;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.accessible_orgs(text), private.has_permission(uuid, text), private.my_orgs()
  to authenticated;
