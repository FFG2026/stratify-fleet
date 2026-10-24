-- A report the fleet withdrew before sending must stay invisible to the insurer. "Sent" means submitted_at is set,
-- not merely that the status has moved on from "reported".
drop policy claims_read on public.claims;
create policy claims_read on public.claims for select to authenticated using (
  private.member_has(fleet_id, 'claim.read')
  or (submitted_at is not null and fleet_id in (select private.accessible_orgs('claim.manage')))
  or (fleet_id = (select private.driver_fleet()) and (reported_by = (select auth.uid()) or driver_user_id = (select auth.uid()))));

create or replace function private.claim_sides(p_claim uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_remove(array[
    case when private.member_has(c.fleet_id, 'claim.read') then 'fleet' end,
    case when c.submitted_at is not null and c.fleet_id in (select private.accessible_orgs('claim.manage')) then 'insurer' end,
    case when c.fleet_id = (select private.driver_fleet())
           and (c.reported_by = (select auth.uid()) or c.driver_user_id = (select auth.uid())) then 'driver' end
  ], null), '{}'::text[])
  from public.claims c where c.id = p_claim
$$;

create or replace function private.insurer_claim(p_claim uuid) returns public.claims
language plpgsql security definer set search_path = '' as $$
declare c public.claims;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or c.submitted_at is null or not private.has_permission(c.fleet_id, 'claim.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  return c;
end $$;
revoke all on function private.insurer_claim(uuid) from public, anon;

create or replace function public.add_claim_note(p_claim uuid, p_body text, p_internal boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.claims; v_side text; v_user uuid := private.require_user(); v_body text := btrim(coalesce(p_body, ''));
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'claim not found' using errcode = '42501'; end if;
  if private.member_has(c.fleet_id, 'claim.report') then v_side := 'fleet';
  elsif c.submitted_at is not null and private.has_permission(c.fleet_id, 'claim.manage') then v_side := 'insurer';
  else raise exception 'permission denied' using errcode = '42501'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then raise exception 'write a note (up to 4,000 characters)' using errcode = '22023'; end if;
  perform private.claim_event(c, 'note', v_side, case when coalesce(p_internal, false) then v_side else 'shared' end, v_body);
  if not coalesce(p_internal, false) and c.submitted_at is not null then
    if v_side = 'insurer' then perform private.notify(c.fleet_id, 'claim.report', null, c.id, 'claim_note', 'Update on ' || c.reference, left(v_body, 300));
    else perform private.notify(c.insurer_id, 'claim.manage', null, c.id, 'claim_note', 'Update on ' || c.reference, left(v_body, 300)); end if;
  end if;
  perform private.write_audit(c.fleet_id, 'claim.note_added', 'claim', c.id, null, jsonb_build_object('side', v_side, 'internal', coalesce(p_internal, false)));
end $$;
