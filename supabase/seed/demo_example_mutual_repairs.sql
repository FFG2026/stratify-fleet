-- Demo repair shop for Example Mutual Insurance (FICTIONAL): one fictional body shop, with up to two open claims passed to it,
-- one waiting for the shop's quote and one with a quote sent for the insurer to approve.
-- No photos or documents are created here (they are real files): sign in as a person added to the shop to upload them.
-- Add that person on the Repair shops page ("Add a person"). Safe to run more than once.
do $$
declare ins uuid; rp uuid; c record; n int := 0;
begin
  select insurer_id into ins from public.policies where id = '30000000-0000-4000-8000-000000000001';
  if ins is null then raise notice 'Example Mutual not found; nothing done.'; return; end if;
  select id into rp from public.repairers where insurer_id = ins and name = 'Northside Autobody (FICTIONAL)';
  if rp is null then
    insert into public.repairers (insurer_id, name) values (ins, 'Northside Autobody (FICTIONAL)') returning id into rp;
  end if;
  for c in select cl.id, cl.fleet_id, cl.reference from public.claims cl
            where cl.insurer_id = ins and cl.status in ('submitted', 'under_review', 'awaiting_information')
              and not exists (select 1 from public.claim_repair r where r.claim_id = cl.id)
            order by cl.submitted_at desc nulls last limit 2 loop
    n := n + 1;
    insert into public.claim_repair (claim_id, repairer_id, insurer_id, fleet_id, status, quote_amount, quote_note, quote_submitted_at)
    values (c.id, rp, ins, c.fleet_id, case when n = 1 then 'with_repairer' else 'quote_submitted' end,
            case when n = 2 then 1840.00 end,
            case when n = 2 then 'Replace nearside wing and bumper, refinish and blend. Parts on 3-day lead time. Includes VAT.' end,
            case when n = 2 then now() - interval '3 hours' end);
  end loop;
  if n = 0 then raise notice 'Repair shop created. There are no open claims for Example Mutual to pass to it; pass one from the claim page.'; end if;
end $$;
