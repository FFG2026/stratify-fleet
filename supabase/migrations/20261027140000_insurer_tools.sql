-- Insurer tools: reminders to the fleet, saved replies, possible-duplicate flags and a daily digest.
-- Nothing here decides a claim or sets an insurer rule: reminders only nudge, duplicates only point, the digest only counts.

-- ---- reminders
alter table public.claim_requests add column last_reminded_at timestamptz, add column reminder_count int not null default 0;

create function public.remind_fleet(p_claim uuid, p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.claims := private.insurer_claim(p_claim);
  r public.claim_requests;
begin
  select * into r from public.claim_requests where id = p_request and claim_id = c.id for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  if r.answered_at is not null or r.cancelled_at is not null then raise exception 'that request is no longer open' using errcode = '22023'; end if;
  if r.last_reminded_at is not null and r.last_reminded_at > now() - interval '1 day' then
    raise exception 'the fleet was already reminded in the last 24 hours' using errcode = '22023'; end if;
  update public.claim_requests set last_reminded_at = now(), reminder_count = reminder_count + 1 where id = r.id;
  perform private.claim_event(c, 'reminder', 'insurer', 'shared', 'Reminder from the insurer: ' || left(r.question, 300));
  perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'info_requested', 'Reminder: the insurer is still waiting on ' || c.reference, left(r.question, 300));
  perform private.ensure_claim_touch(c.id, auth.uid());
  perform private.write_audit(c.fleet_id, 'claim.fleet_reminded', 'claim', c.id, null, jsonb_build_object('request', r.id));
end $$;

-- Run once a day by the server (service role only). Reminds the fleet when a request is past the date the insurer set for it,
-- then every three days after that, at most three times. Returns the claims it reminded so the server can email the fleet.
create function public.run_overdue_reminders() returns table (claim_id uuid)
language plpgsql security definer set search_path = '' as $$
declare r public.claim_requests; c public.claims;
begin
  for r in select * from public.claim_requests q
            where q.answered_at is null and q.cancelled_at is null and q.due_on is not null and q.due_on < current_date
              and q.reminder_count < 3 and (q.last_reminded_at is null or q.last_reminded_at < now() - interval '3 days')
            for update skip locked loop
    select * into c from public.claims where id = r.claim_id;
    continue when c.status = 'closed';
    update public.claim_requests set last_reminded_at = now(), reminder_count = reminder_count + 1 where id = r.id;
    perform private.claim_event(c, 'reminder', 'insurer', 'shared', 'This request is past its due date: ' || left(r.question, 300));
    perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'info_requested', 'Overdue: ' || c.reference || ' is waiting on you', left(r.question, 300));
    claim_id := c.id; return next;
  end loop;
end $$;

-- ---- saved replies (wording an insurer reuses; each insurer's own)
create table public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  insurer_id uuid not null references public.organisations (id),
  title text not null check (char_length(title) between 2 and 80),
  body text not null check (char_length(body) between 2 and 1000),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index saved_replies_insurer_idx on public.saved_replies (insurer_id, created_at);
alter table public.saved_replies enable row level security;
create policy saved_replies_read on public.saved_replies for select to authenticated using (private.has_permission(insurer_id, 'claim.manage'));
revoke all on public.saved_replies from anon;
revoke insert, update, delete, truncate on public.saved_replies from authenticated;
grant select on public.saved_replies to authenticated;

create function public.save_reply(p_insurer uuid, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_id uuid;
begin
  if not exists (select 1 from public.organisations where id = p_insurer and kind = 'insurer') or not private.has_permission(p_insurer, 'claim.manage') then
    raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'give the reply a short title' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 2 and 1000 then raise exception 'the reply must be 2 to 1000 characters' using errcode = '22023'; end if;
  if (select count(*) from public.saved_replies where insurer_id = p_insurer) >= 30 then raise exception 'you can keep up to 30 saved replies' using errcode = '22023'; end if;
  insert into public.saved_replies (insurer_id, title, body, created_by) values (p_insurer, btrim(p_title), btrim(p_body), v_user) returning id into v_id;
  perform private.write_audit(p_insurer, 'saved_reply.created', 'saved_reply', v_id, null, jsonb_build_object('title', btrim(p_title)));
  return v_id;
end $$;

create function public.delete_saved_reply(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.saved_replies; v_user uuid := private.require_user();
begin
  select * into s from public.saved_replies where id = p_id;
  if not found or not private.has_permission(s.insurer_id, 'claim.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  delete from public.saved_replies where id = p_id;
  perform private.write_audit(s.insurer_id, 'saved_reply.deleted', 'saved_reply', p_id, jsonb_build_object('title', s.title), null);
end $$;

-- ---- possible duplicates: other claims on the same vehicle, same fleet, with an incident within 7 days either side.
-- Advisory only. It says "look at these"; the insurer decides what they mean.
create function public.claim_possible_duplicates(p_claim uuid) returns table (id uuid, reference text, incident_at timestamptz, status text, location text)
language plpgsql stable security definer set search_path = '' as $$
declare c public.claims;
begin
  select * into c from public.claims where claims.id = p_claim;
  if not found or c.status = 'reported' or not private.has_permission(c.fleet_id, 'claim.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query select o.id, o.reference, o.incident_at, o.status, o.location from public.claims o
    where o.fleet_id = c.fleet_id and o.id <> c.id and o.status <> 'reported' and o.registration = c.registration
      and abs(extract(epoch from (o.incident_at - c.incident_at))) <= 7 * 86400
    order by o.incident_at desc limit 10;
end $$;

-- ---- daily digest. Counts only; opt-out per person.
create table public.digest_optout (user_id uuid primary key, created_at timestamptz not null default now());
alter table public.digest_optout enable row level security;
create policy digest_optout_own on public.digest_optout for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.digest_optout from anon;
revoke insert, update, delete, truncate on public.digest_optout from authenticated;
grant select on public.digest_optout to authenticated;

create function public.set_digest(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user();
begin
  if p_enabled then delete from public.digest_optout where user_id = v_user;
  else insert into public.digest_optout (user_id) values (v_user) on conflict do nothing; end if;
end $$;

create function public.insurer_digest() returns table (email text, unassigned int, replies int, waiting int, past_due int)
language sql security definer set search_path = '' as $$
  with people as (
    select distinct m.user_id, m.organisation_id as insurer_id from public.memberships m
      join public.organisations o on o.id = m.organisation_id and o.kind = 'insurer'
      join public.role_permissions rp on rp.role = m.role and rp.permission = 'claim.manage'
     where m.active and not exists (select 1 from public.digest_optout d where d.user_id = m.user_id)),
  stats as (
    select c.insurer_id,
      count(*) filter (where c.status in ('submitted', 'under_review', 'awaiting_information') and not exists (select 1 from public.claim_handling h where h.claim_id = c.id and h.handler_id is not null)) as unassigned,
      count(*) filter (where c.status = 'awaiting_information') as waiting,
      count(*) filter (where exists (select 1 from public.claim_requests q where q.claim_id = c.id and q.answered_at is null and q.cancelled_at is null and q.due_on < current_date)) as past_due,
      count(*) filter (where c.status <> 'closed' and exists (select 1 from public.claim_events e where e.claim_id = c.id and e.kind = 'info_provided' and e.created_at > now() - interval '1 day')) as replies
    from public.claims c where c.status <> 'reported' group by c.insurer_id)
  select lower(u.email)::text, s.unassigned::int, s.replies::int, s.waiting::int, s.past_due::int
    from people p join stats s on s.insurer_id = p.insurer_id join auth.users u on u.id = p.user_id
   where u.email is not null and u.email_confirmed_at is not null and (s.unassigned + s.replies + s.waiting + s.past_due) > 0
$$;

revoke all on function public.remind_fleet(uuid, uuid), public.run_overdue_reminders(), public.save_reply(uuid, text, text), public.delete_saved_reply(uuid),
  public.claim_possible_duplicates(uuid), public.set_digest(boolean), public.insurer_digest() from public, anon;
grant execute on function public.remind_fleet(uuid, uuid), public.save_reply(uuid, text, text), public.delete_saved_reply(uuid),
  public.claim_possible_duplicates(uuid), public.set_digest(boolean) to authenticated;
revoke execute on function public.run_overdue_reminders(), public.insurer_digest() from authenticated;
grant execute on function public.run_overdue_reminders(), public.insurer_digest() to service_role;
