-- Audit screen feed, per-insurer branding, and a hardening fix.

-- 1. Hardening: pin the search path of the claim field checker.
alter function private.check_claim_fields(timestamptz, text, text, boolean, text) set search_path = '';

-- 2. Audit feed: the audit log with the actor's email, limited to organisations the caller may audit. Details (before/after states) are not returned.
create function public.audit_feed(p_org uuid default null, p_action text default null, p_limit int default 50, p_offset int default 0)
returns table (id bigint, occurred_at timestamptz, actor_email text, actor_kind text, organisation_id uuid, action text, entity_type text, note text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_like text := nullif(btrim(coalesce(p_action, '')), '');
begin
  perform private.require_user();
  if p_limit is null or p_limit < 1 or p_limit > 200 then p_limit := 50; end if;
  if p_offset is null or p_offset < 0 then p_offset := 0; end if;
  if v_like is not null then v_like := replace(replace(replace(v_like, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select a.id, a.occurred_at, lower(u.email)::text, a.actor_kind, a.organisation_id, a.action, a.entity_type, a.note, count(*) over ()
      from public.audit_logs a
      left join auth.users u on u.id = a.actor_id
     where a.organisation_id in (select private.accessible_orgs('audit.read'))
       and (p_org is null or a.organisation_id = p_org)
       and (v_like is null or a.action ilike v_like)
     order by a.occurred_at desc, a.id desc
     limit p_limit offset p_offset;
end $$;
revoke all on function public.audit_feed(uuid, text, int, int) from public, anon;
grant execute on function public.audit_feed(uuid, text, int, int) to authenticated;

-- 3. Branding: an insurer's own display name and accent colour, shown to its staff and its customers' people.
insert into public.permissions (code, description) values ('branding.manage', 'Set the insurer display name and accent colour');
insert into public.role_permissions (role, permission) values ('platform_super_admin', 'branding.manage'), ('insurer_admin', 'branding.manage');

create table public.org_branding (
  insurer_id   uuid primary key references public.organisations (id),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 60),
  accent       text check (accent is null or accent ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
alter table public.org_branding enable row level security;
create policy org_branding_read on public.org_branding for select to authenticated
  using (insurer_id in (select private.accessible_orgs('branding.manage')));
revoke all on public.org_branding from anon;
revoke insert, update, delete, truncate on public.org_branding from authenticated;
grant select on public.org_branding to authenticated;

create function public.set_branding(p_insurer uuid, p_display_name text, p_accent text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := nullif(btrim(coalesce(p_display_name, '')), ''); v_acc text := nullif(btrim(coalesce(p_accent, '')), ''); v_old public.org_branding;
begin
  perform private.require_user();
  if not exists (select 1 from public.organisations where id = p_insurer and kind = 'insurer') then raise exception 'insurer not found' using errcode = 'P0002'; end if;
  if not private.has_permission(p_insurer, 'branding.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_name is not null and char_length(v_name) > 60 then raise exception 'the display name is too long' using errcode = '22023'; end if;
  if v_acc is not null and v_acc !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'the colour must look like #226B55' using errcode = '22023'; end if;
  select * into v_old from public.org_branding where insurer_id = p_insurer;
  insert into public.org_branding (insurer_id, display_name, accent, updated_by) values (p_insurer, v_name, v_acc, (select auth.uid()))
    on conflict (insurer_id) do update set display_name = excluded.display_name, accent = excluded.accent, updated_at = now(), updated_by = excluded.updated_by;
  perform private.write_audit(p_insurer, 'branding.changed', 'organisation', p_insurer, to_jsonb(v_old), jsonb_build_object('display_name', v_name, 'accent', v_acc));
end $$;
revoke all on function public.set_branding(uuid, text, text) from public, anon;
grant execute on function public.set_branding(uuid, text, text) to authenticated;

-- The branding that applies to the signed-in person: their insurer's, or their customer's insurer's. Platform staff get none.
create function public.my_branding() returns table (display_name text, accent text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  return query
    select b.display_name, b.accent
      from public.memberships m
      join public.organisations o on o.id = m.organisation_id
      join public.org_branding b on b.insurer_id = case when o.kind = 'insurer' then o.id else o.insurer_id end
     where m.user_id = (select auth.uid()) and m.active and o.kind <> 'platform'
     order by m.created_at limit 1;
end $$;
revoke all on function public.my_branding() from public, anon;
grant execute on function public.my_branding() to authenticated;
