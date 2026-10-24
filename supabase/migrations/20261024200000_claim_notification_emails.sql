-- Email delivery of claim notifications. The app (server side, with the service key) asks for who to email; each notification is handed out once.
alter table public.notifications add column emailed_at timestamptz;

create function public.claim_notification_emails(p_claim uuid) returns table (notification_id uuid, email text, title text, kind text)
language sql security definer set search_path = '' as $$
  with n as (
    update public.notifications set emailed_at = now()
     where claim_id = p_claim and emailed_at is null and created_at > now() - interval '1 day'
    returning id, organisation_id, perm, user_id, title, kind)
  select n.id, lower(u.email)::text, n.title, n.kind
    from n
    join lateral (
      select m.user_id from public.memberships m
        join public.role_permissions rp on rp.role = m.role and rp.permission = n.perm
       where n.user_id is null and m.active and m.organisation_id = n.organisation_id
      union
      select n.user_id where n.user_id is not null) r on true
    join auth.users u on u.id = r.user_id
   where u.email is not null and u.email_confirmed_at is not null
$$;
revoke all on function public.claim_notification_emails(uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(uuid) to service_role;
