-- CUE (Claims and Underwriting Exchange) queue.
-- CUE is a claims-history database run by the MIB that insurers contribute to. It belongs to the insurer, not the fleet,
-- so everything here is insurer side only: a fleet or driver can neither see nor trigger it.
-- One press on a sent claim prepares a CUE-ready record from the claim's FNOL data and queues it. The portal is NOT connected
-- to CUE: queueing transmits nothing, and the record can be downloaded for the insurer to enter through its own CUE route.
-- Each press that finds changed claim data adds a new version; earlier versions are kept.
-- The record holds structured facts only. Free-text narrative, injury details, phone numbers and witness names stay in the portal.

create table public.cue_submissions (
  id                 uuid primary key default gen_random_uuid(),
  claim_id           uuid not null references public.claims (id),
  fleet_id           uuid not null references public.organisations (id),
  insurer_id         uuid not null references public.organisations (id),
  version            integer not null check (version >= 1),
  submission_status  text not null default 'queued'
    check (submission_status in ('queued', 'submitted', 'accepted', 'rejected', 'error')),
  status_detail      text not null default 'Integration not configured; nothing has been transmitted.',
  external_reference text,
  payload            jsonb not null,
  created_by         uuid not null references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (claim_id, version)
);
create index cue_submissions_insurer_status_idx on public.cue_submissions (insurer_id, submission_status);
create index cue_submissions_fleet_idx on public.cue_submissions (fleet_id);

alter table public.cue_submissions enable row level security;
-- Same rule as an insurer reading a sent claim: the fleet must be one the person may manage claims for.
create policy cue_submissions_read on public.cue_submissions for select to authenticated
  using (fleet_id in (select private.accessible_orgs('claim.manage')));
revoke all on public.cue_submissions from anon;
revoke insert, update, delete, truncate on public.cue_submissions from authenticated;

-- The structured record for one claim, as it stands now.
create function private.cue_payload(c public.claims) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'schema', 'stratify.cue_record.v1',
    'note', 'FNOL data from the Stratify portal, prepared for CUE. Field mapping to the insurer''s CUE contribution format is not confirmed.',
    'claim', jsonb_build_object(
      'reference', c.reference, 'insurer_reference', c.insurer_reference, 'status', c.status, 'origin', c.origin,
      'incident_at', c.incident_at, 'sent_to_insurer_at', c.submitted_at, 'outcome', c.outcome, 'closed_at', c.closed_at),
    'insurer', (select o.name from public.organisations o where o.id = c.insurer_id),
    'policy_reference', (select p.policy_number from public.policies p where p.id = c.policy_id),
    'policyholder', (select o.name from public.organisations o where o.id = c.fleet_id),
    'vehicle', jsonb_build_object('registration', c.registration, 'on_cover_at_incident', c.on_cover_at_incident),
    'driver_name', c.driver_name,
    'incident', jsonb_build_object(
      'location', c.location, 'injury_reported', c.anyone_injured, 'police_attended', c.police_attended,
      'police_reference', c.police_reference, 'vehicle_driveable', c.vehicle_driveable, 'third_party_involved', c.third_party_involved),
    'third_parties', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'vehicle_registration', p.vehicle_registration, 'insurer', p.insurer_name, 'injured', p.injured) order by p.created_at)
      from public.claim_parties p where p.claim_id = c.id and p.kind = 'third_party' and p.deleted_at is null), '[]'::jsonb),
    'witness_count', (select count(*) from public.claim_parties p where p.claim_id = c.id and p.kind = 'witness' and p.deleted_at is null),
    'evidence', jsonb_build_object(
      'photos', (select count(*) from public.claim_attachments a where a.claim_id = c.id and a.deleted_at is null and a.kind = 'photo'),
      'documents', (select count(*) from public.claim_attachments a where a.claim_id = c.id and a.deleted_at is null and a.kind = 'document'))
  )
$$;

-- One press: prepare the record from the claim as it is now and queue it. Insurer side only, and only for a claim that has been sent.
create function public.queue_cue_submission(p_claim uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); c public.claims := private.insurer_claim(p_claim);
  v_payload jsonb; v_last public.cue_submissions; v_id uuid; v_version integer;
begin
  v_payload := private.cue_payload(c);
  select * into v_last from public.cue_submissions where claim_id = c.id order by version desc limit 1;
  if found and v_last.payload = v_payload then
    raise exception 'nothing has changed since version % was queued', v_last.version using errcode = '22023';
  end if;
  v_version := coalesce(v_last.version, 0) + 1;
  insert into public.cue_submissions (claim_id, fleet_id, insurer_id, version, payload, created_by)
  values (c.id, c.fleet_id, c.insurer_id, v_version, v_payload, v_user) returning id into v_id;
  perform private.claim_event(c, 'cue_queued', 'insurer', 'insurer',
    'CUE record version ' || v_version || ' prepared and queued. The portal is not connected to CUE, so nothing was transmitted.');
  perform private.write_audit(c.fleet_id, 'claim.cue_queued', 'claim', c.id, null, jsonb_build_object('submission', v_id, 'version', v_version));
  return v_id;
end $$;

-- The record holds personal data, so each download is written to the audit trail.
create function public.log_cue_download(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); s public.cue_submissions;
begin
  select * into s from public.cue_submissions where id = p_id;
  if not found or not private.has_permission(s.fleet_id, 'claim.manage') then raise exception 'record not found' using errcode = '42501'; end if;
  perform private.write_audit(s.fleet_id, 'claim.cue_downloaded', 'claim', s.claim_id, null, jsonb_build_object('submission', s.id, 'version', s.version));
end $$;

revoke all on function public.queue_cue_submission(uuid), public.log_cue_download(uuid), private.cue_payload(public.claims) from public, anon;
grant execute on function public.queue_cue_submission(uuid), public.log_cue_download(uuid) to authenticated;
