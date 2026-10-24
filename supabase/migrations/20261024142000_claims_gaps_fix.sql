-- Fix: appending a text literal to a text[] with || is read as an array literal. Use array_append.
create or replace function private.claim_gaps(c public.claims) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare g text[] := '{}';
begin
  if c.police_attended is null then g := array_append(g, 'say whether the police attended'); end if;
  if c.third_party_involved is null then g := array_append(g, 'say whether another vehicle or person was involved'); end if;
  if c.third_party_involved and not exists (select 1 from public.claim_parties p where p.claim_id = c.id and p.kind = 'third_party' and p.deleted_at is null) then
    g := array_append(g, 'add the other party''s details'); end if;
  if not c.no_photos_confirmed and not exists (select 1 from public.claim_attachments a where a.claim_id = c.id and a.deleted_at is null) then
    g := array_append(g, 'add photos, or confirm that none are available'); end if;
  return g;
end $$;
revoke all on function private.claim_gaps(public.claims) from public, anon;
