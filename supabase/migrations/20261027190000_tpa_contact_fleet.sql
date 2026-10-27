-- TPAs do the fleet contact on behalf of the insurer (the insurer still decides and closes the claim).
-- A TPA person can message the fleet, ask for photos or documents, and remind the fleet, on a claim routed to their TPA.
-- To the fleet these appear as coming from the insurer. They are also told when the fleet replies.

create function public.tpa_note_to_fleet(p_claim uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims; v_user uuid := private.require_user(); v_body text := btrim(coalesce(p_body, ''));
begin
  c := private.tpa_claim(p_claim);
  if c.status = 'closed' then raise exception 'this claim is closed' using errcode = '22023'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then raise exception 'write a note (up to 4,000 characters)' using errcode = '22023'; end if;
  perform private.claim_event(c, 'note', 'insurer', 'shared', v_body);
  perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'claim_note', 'Update on ' || c.reference, left(v_body, 300));
  update public.claim_tpa set first_touched_at = coalesce(first_touched_at, now()) where claim_id = c.id;
  update public.claims set updated_at = now() where id = c.id;
  perform private.write_audit(c.insurer_id, 'claim.tpa_contacted_fleet', 'claim', c.id, null, jsonb_build_object('kind', 'note'));
end $$;

create function public.tpa_request_claim_items(p_claim uuid, p_items jsonb, p_message text, p_due date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.claims;
  v_user uuid := private.require_user();
  v_id uuid; v_item jsonb; v_kind text; v_label text; v_list text := ''; v_msg text; v_n int := 0; v_seen text[] := '{}';
begin
  c := private.tpa_claim(p_claim);
  if c.status = 'closed' then raise exception 'this claim is closed' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 6 then
    raise exception 'choose between one and six items' using errcode = '22023'; end if;
  if p_due is not null and p_due < current_date then raise exception 'the due date is in the past' using errcode = '22023'; end if;
  v_msg := nullif(btrim(coalesce(p_message, '')), '');
  if v_msg is not null and char_length(v_msg) > 1000 then raise exception 'the message is too long' using errcode = '22023'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_kind := v_item ->> 'kind';
    v_label := nullif(btrim(coalesce(v_item ->> 'label', '')), '');
    if v_kind not in ('photos', 'estimate', 'police_report', 'witness_statement', 'other') then raise exception 'unknown item' using errcode = '22023'; end if;
    if v_kind = 'other' and (v_label is null or char_length(v_label) not between 2 and 120) then raise exception 'say what the other item is' using errcode = '22023'; end if;
    if v_kind <> 'other' then v_label := null; end if;
    if (v_kind || coalesce(v_label, '')) = any (v_seen) then raise exception 'each item can only be asked for once' using errcode = '22023'; end if;
    v_seen := v_seen || (v_kind || coalesce(v_label, ''));
    v_list := v_list || case when v_list = '' then '' else ', ' end || private.item_label(v_kind, v_label);
    v_n := v_n + 1;
  end loop;
  insert into public.claim_requests (claim_id, fleet_id, question, due_on, requested_by)
    values (c.id, c.fleet_id, left('Please send: ' || v_list || '.' || coalesce(' ' || v_msg, ''), 2000), p_due, v_user) returning id into v_id;
  insert into public.claim_request_items (request_id, claim_id, fleet_id, kind, label)
    select v_id, c.id, c.fleet_id, i ->> 'kind', case when i ->> 'kind' = 'other' then btrim(i ->> 'label') end from jsonb_array_elements(p_items) i;
  update public.claims set status = 'awaiting_information', updated_at = now() where id = c.id;
  perform private.claim_event(c, 'info_requested', 'insurer', 'shared', 'Requested: ' || v_list || '.' || coalesce(' ' || v_msg, ''));
  perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'info_requested', 'The insurer needs documents or photos on ' || c.reference, left(v_list, 300));
  update public.claim_tpa set first_touched_at = coalesce(first_touched_at, now()) where claim_id = c.id;
  perform private.write_audit(c.insurer_id, 'claim.tpa_contacted_fleet', 'claim', c.id, null, jsonb_build_object('kind', 'items_request', 'request', v_id, 'items', v_n));
  return v_id;
end $$;

create function public.tpa_remind_fleet(p_claim uuid, p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims; r public.claim_requests;
begin
  perform private.require_user();
  c := private.tpa_claim(p_claim);
  select * into r from public.claim_requests where id = p_request and claim_id = c.id for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  if r.answered_at is not null or r.cancelled_at is not null then raise exception 'that request is no longer open' using errcode = '22023'; end if;
  if r.last_reminded_at is not null and r.last_reminded_at > now() - interval '1 day' then
    raise exception 'the fleet was already reminded in the last 24 hours' using errcode = '22023'; end if;
  update public.claim_requests set last_reminded_at = now(), reminder_count = reminder_count + 1 where id = r.id;
  perform private.claim_event(c, 'reminder', 'insurer', 'shared', 'Reminder from the insurer: ' || left(r.question, 300));
  perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'info_requested', 'Reminder: the insurer is still waiting on ' || c.reference, left(r.question, 300));
  update public.claim_tpa set first_touched_at = coalesce(first_touched_at, now()) where claim_id = c.id;
  perform private.write_audit(c.insurer_id, 'claim.tpa_contacted_fleet', 'claim', c.id, null, jsonb_build_object('kind', 'reminder', 'request', r.id));
end $$;

-- When the fleet or driver replies, tell the people at the TPA the claim is routed to.
create function private.notify_tpa_of_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; c public.claims;
begin
  if new.side not in ('fleet', 'driver') or new.visibility <> 'shared' then return new; end if;
  select * into c from public.claims where id = new.claim_id;
  for r in select m.user_id from public.claim_tpa ct
             join public.tpa_members m on m.tpa_id = ct.tpa_id and m.active
             join public.tpas t on t.id = ct.tpa_id and t.active
            where ct.claim_id = new.claim_id loop
    perform private.notify(null, null, r.user_id, new.claim_id, 'fleet_reply', 'Reply on ' || c.reference, left(coalesce(new.body, ''), 300));
  end loop;
  return new;
end $$;
create trigger claim_events_notify_tpa after insert on public.claim_events
  for each row execute function private.notify_tpa_of_reply();

revoke all on function public.tpa_note_to_fleet(uuid, text), public.tpa_request_claim_items(uuid, jsonb, text, date), public.tpa_remind_fleet(uuid, uuid) from public, anon;
grant execute on function public.tpa_note_to_fleet(uuid, text), public.tpa_request_claim_items(uuid, jsonb, text, date), public.tpa_remind_fleet(uuid, uuid) to authenticated;
revoke all on function private.notify_tpa_of_reply() from public, anon, authenticated;
