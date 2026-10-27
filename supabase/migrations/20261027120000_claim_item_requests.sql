-- Insurers can ask the fleet for specific things (photos, an estimate, a police report, a witness statement, or something else),
-- and see at a glance which have arrived. The fleet gets a checklist and uploads against each item, or says it cannot supply one.
-- Still a question to the fleet: it sits on public.claim_requests, so the existing status, notification and audit behaviour applies.

create table public.claim_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.claim_requests (id) on delete cascade,
  claim_id uuid not null references public.claims (id),
  fleet_id uuid not null references public.organisations (id),
  kind text not null check (kind in ('photos', 'estimate', 'police_report', 'witness_statement', 'other')),
  label text check (label is null or char_length(label) between 2 and 120),
  created_at timestamptz not null default clock_timestamp(),
  fulfilled_at timestamptz,
  attachment_id uuid references public.claim_attachments (id),
  unavailable_reason text check (unavailable_reason is null or char_length(unavailable_reason) between 3 and 300),
  check (kind <> 'other' or label is not null),
  check (attachment_id is null or unavailable_reason is null)
);
create index claim_request_items_request_idx on public.claim_request_items (request_id);
create index claim_request_items_claim_idx on public.claim_request_items (claim_id);
alter table public.claim_request_items enable row level security;
create policy claim_request_items_read on public.claim_request_items for select to authenticated
  using (cardinality(private.claim_sides(claim_id)) > 0);
revoke all on public.claim_request_items from anon;
revoke insert, update, delete, truncate on public.claim_request_items from authenticated;
grant select on public.claim_request_items to authenticated;

create function private.item_label(p_kind text, p_label text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'photos' then 'More photos'
    when 'estimate' then 'Repair estimate'
    when 'police_report' then 'Police report'
    when 'witness_statement' then 'Witness statement'
    else coalesce(p_label, 'Other') end
$$;

-- p_items: a JSON array like [{"kind":"photos"},{"kind":"other","label":"Dashcam footage"}]
create function public.request_claim_items(p_claim uuid, p_items jsonb, p_message text, p_due date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.claims := private.insurer_claim(p_claim);
  v_user uuid := private.require_user();
  v_id uuid; v_item jsonb; v_kind text; v_label text; v_list text := ''; v_msg text; v_n int := 0; v_seen text[] := '{}';
begin
  if c.status = 'closed' then raise exception 'this claim is closed; reopen it first' using errcode = '22023'; end if;
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
  perform private.ensure_claim_touch(c.id, v_user);
  perform private.write_audit(c.fleet_id, 'claim.items_requested', 'claim', c.id, null, jsonb_build_object('request', v_id, 'items', v_n));
  return v_id;
end $$;

-- Fleet side: tick an item off with an uploaded file, or say it cannot be supplied.
create function public.fulfil_request_item(p_item uuid, p_attachment uuid, p_unavailable text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  it public.claim_request_items; r public.claim_requests; c public.claims; a public.claim_attachments;
  v_user uuid := private.require_user(); v_reason text := nullif(btrim(coalesce(p_unavailable, '')), ''); v_left int;
begin
  select * into it from public.claim_request_items where id = p_item for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select * into c from public.claims where id = it.claim_id for update;
  if not private.member_has(c.fleet_id, 'claim.report') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into r from public.claim_requests where id = it.request_id for update;
  if r.answered_at is not null or r.cancelled_at is not null then raise exception 'that request is no longer open' using errcode = '22023'; end if;
  if it.fulfilled_at is not null then raise exception 'that item has already been dealt with' using errcode = '22023'; end if;
  if p_attachment is not null then
    select * into a from public.claim_attachments where id = p_attachment and claim_id = c.id and deleted_at is null;
    if not found then raise exception 'file not found' using errcode = '22023'; end if;
    update public.claim_request_items set fulfilled_at = now(), attachment_id = a.id where id = it.id;
  elsif v_reason is not null and char_length(v_reason) between 3 and 300 then
    update public.claim_request_items set fulfilled_at = now(), unavailable_reason = v_reason where id = it.id;
  else
    raise exception 'upload a file, or say why it cannot be supplied' using errcode = '22023';
  end if;
  perform private.claim_event(c, 'info_provided', 'fleet', 'shared',
    private.item_label(it.kind, it.label) || case when p_attachment is not null then ' sent.' else ' not available: ' || v_reason end);
  select count(*) into v_left from public.claim_request_items where request_id = r.id and fulfilled_at is null;
  if v_left = 0 then
    update public.claim_requests set answered_at = now(), answered_by = v_user, answer = 'All the requested items have been dealt with.' where id = r.id;
    perform private.settle_status(c.id);
    perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'info_provided', 'All requested items received on ' || c.reference, null);
  end if;
  perform private.write_audit(c.fleet_id, 'claim.item_fulfilled', 'claim', c.id, null, jsonb_build_object('item', it.id, 'attachment', p_attachment));
end $$;

revoke all on function private.item_label(text, text), public.request_claim_items(uuid, jsonb, text, date), public.fulfil_request_item(uuid, uuid, text) from public, anon;
grant execute on function public.request_claim_items(uuid, jsonb, text, date), public.fulfil_request_item(uuid, uuid, text) to authenticated;
