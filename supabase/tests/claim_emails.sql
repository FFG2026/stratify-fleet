-- Claim email recipients test (uses the first claim in the database). Rolls back.
do $$
declare c public.claims; n int := 0; rows int;
begin
  select * into c from public.claims limit 1;
  insert into public.notifications (organisation_id, perm, claim_id, kind, title) values (c.fleet_id, 'claim.read', c.id, 'claim_status', 'test fleet notice');
  insert into public.notifications (user_id, claim_id, kind, title) values ('68939de2-3e13-4b66-9115-0b0a742ea1ed', c.id, 'claim_closed', 'test driver notice');
  select count(*) into rows from public.claim_notification_emails(c.id);
  if rows < 2 then raise exception 'T1 expected a fleet and a driver recipient, got %', rows; end if; n := n + 1;
  select count(*) into rows from public.claim_notification_emails(c.id);
  if rows <> 0 then raise exception 'T2 notifications handed out twice (%)', rows; end if; n := n + 1;
  insert into public.notifications (organisation_id, perm, claim_id, kind, title) values (c.insurer_id, 'claim.manage', c.id, 'claim_submitted', 'test insurer notice');
  select count(*) filter (where title = 'test insurer notice') into rows from public.claim_notification_emails(c.id);
  if rows < 1 then raise exception 'T3 insurer staff not found'; end if; n := n + 1;
  begin set local role authenticated; perform * from public.claim_notification_emails(c.id); raise exception 'T4 signed-in user can call it'; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  raise exception 'EMAIL RECIPIENT TESTS PASSED (% checks)', n;
end $$;
