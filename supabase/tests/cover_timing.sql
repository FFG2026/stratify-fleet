-- Cover timing: fleets cannot record cover earlier than now; insurer admins can (deliberately). Rolled back; always ends with a raise.
do $$
declare
  F uuid := '58a9ced1-d80a-43e8-b1d9-9567d9011dee'; I uuid := 'ac389563-9113-49a2-9ab1-16a7d602fb45'; f1 uuid := '20000000-0000-4000-8000-000000000001';
  p uuid; per uuid; per2 uuid; n int := 0; ok boolean;
begin
  select id into p from public.policies where fleet_id = f1 and active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.add_vehicle_cover(f1, p, 'ZZ98ZZZ', date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London', 'earlier today');
    raise exception 'T1 earlier today allowed'; exception when sqlstate '42501' then n := n + 1; end;
  per := public.add_vehicle_cover(f1, p, 'ZZ98ZZZ', now(), 'now'); n := n + 1;
  perform public.add_vehicle_cover(f1, p, 'ZZ97ZZZ', now() + interval '1 day', 'tomorrow'); n := n + 1;
  perform public.remove_vehicle_cover((select vehicle_id from public.coverage_periods where id = per), now() + interval '1 hour', 'ok'); n := n + 1;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true); set local role authenticated;
  per2 := public.add_vehicle_cover(f1, p, 'ZZ96ZZZ', now() - interval '3 hours', 'insurer backdate'); n := n + 1;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.remove_vehicle_cover((select vehicle_id from public.coverage_periods where id = per2), now() - interval '1 hour', 'fleet ends in the past');
    raise exception 'T5 fleet ended cover in the past'; exception when sqlstate '42501' then n := n + 1; end;
  reset role;
  select created_at > cover_start into ok from public.coverage_periods where id = per2; n := n + 1; if not ok then raise exception 'T6 created_at not after backdated start'; end if;
  raise exception 'COVER TIMING TESTS PASSED (% checks)', n;
end $$;
