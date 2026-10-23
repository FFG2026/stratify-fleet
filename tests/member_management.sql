-- Transaction test for user management. Always ends with an exception so NOTHING is saved.
-- Run on a DEVELOPMENT database that has the seed data and the five test logins. Read the RESULTS in the error text.
do $$
declare
  owen uuid := (select id from auth.users where email='owen@dcfgroup.co.uk');
  adam uuid := (select id from auth.users where email='adam@ajrphillips.co.uk');
  insurer uuid := (select id from auth.users where email='insurer@stratifyfleet.co.uk');
  cust uuid := (select id from auth.users where email='customer@stratifyfleet.co.uk');
  demo uuid := (select id from auth.users where email='demo@stratifyfleet.co.uk');
  mutual uuid := '10000000-0000-4000-8000-000000000002';
  platform uuid := '10000000-0000-4000-8000-000000000001';
  north uuid := '20000000-0000-4000-8000-000000000001';
  river uuid := '20000000-0000-4000-8000-000000000002';
  hill uuid := '20000000-0000-4000-8000-000000000003';
  cust_m uuid; adam_m uuid; res text := '';
  procedure_unused int;
begin
  perform set_config('t.out','',true);
  select id into cust_m from public.memberships where user_id=cust and organisation_id=north;
  select id into adam_m from public.memberships where user_id=adam and organisation_id=platform;
  -- each case: label, acting user, statement, expectation ('ok' or 'denied')
  for res in select unnest(array[
    'insurer lists own members|'||insurer||'|select * from public.list_members('''||mutual||''')|ok',
    'insurer lists a customer''s members|'||insurer||'|select * from public.list_members('''||north||''')|ok',
    'insurer lists other insurer''s customer|'||insurer||'|select * from public.list_members('''||hill||''')|denied',
    'insurer lists platform members|'||insurer||'|select * from public.list_members('''||platform||''')|denied',
    'customer lists own members|'||cust||'|select * from public.list_members('''||north||''')|ok',
    'customer lists another customer|'||cust||'|select * from public.list_members('''||river||''')|denied',
    'customer lists its insurer|'||cust||'|select * from public.list_members('''||mutual||''')|denied',
    'insurer adds existing user to its customer|'||insurer||'|select public.add_member('''||north||''',''demo@stratifyfleet.co.uk'',''fleet_manager'')|ok',
    'insurer invites a new email to its customer|'||insurer||'|select public.add_member('''||river||''',''New.Person@Example.com'',''fleet_manager'')|ok',
    'insurer invites into other insurer''s customer|'||insurer||'|select public.add_member('''||hill||''',''x@example.com'',''fleet_manager'')|denied',
    'insurer makes a platform admin|'||insurer||'|select public.add_member('''||platform||''',''x@example.com'',''platform_super_admin'')|denied',
    'insurer gives customer an insurer role|'||insurer||'|select public.add_member('''||river||''',''y@example.com'',''insurer_admin'')|denied',
    'customer invites into own fleet|'||cust||'|select public.add_member('''||north||''',''driver1@example.com'',''fleet_manager'')|ok',
    'customer invites into another fleet|'||cust||'|select public.add_member('''||river||''',''z@example.com'',''fleet_manager'')|denied',
    'customer changes own role|'||cust||'|select public.change_member_role('''||cust_m||''',''fleet_manager'')|denied',
    'insurer demotes the only customer admin|'||insurer||'|select public.change_member_role('''||cust_m||''',''fleet_manager'')|denied',
    'insurer switches off the only customer admin|'||insurer||'|select public.set_member_active('''||cust_m||''',false)|denied',
    'owen switches off adam (platform has two admins)|'||owen||'|select public.set_member_active('''||adam_m||''',false)|ok',
    'insurer touches a platform membership|'||insurer||'|select public.set_member_active('''||adam_m||''',false)|denied',
    'customer touches a platform membership|'||cust||'|select public.set_member_active('''||adam_m||''',false)|denied',
    'demo (no membership) lists members|'||demo||'|select * from public.list_members('''||north||''')|denied',
    'demo (no membership) adds a member|'||demo||'|select public.add_member('''||north||''',''q@example.com'',''fleet_admin'')|denied'
  ]) loop
    declare p text[] := string_to_array(res,'|'); outcome text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p[2], 'role','authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        execute p[3];
        outcome := 'ok';
      exception when others then outcome := 'denied (' || sqlerrm || ')';
      end;
      execute 'reset role';
      perform set_config('t.out', current_setting('t.out') || format(E'%s %s: expected %s, got %s\n',
        case when left(outcome, length(p[4])) = p[4] then 'PASS' else 'FAIL' end, p[1], p[4], outcome), true);
    end;
  end loop;

  -- invitation is claimed at first confirmed sign-in
  insert into public.invitations (organisation_id, email, role) values (hill, 'demo@stratifyfleet.co.uk', 'fleet_manager');
  perform set_config('request.jwt.claims', json_build_object('sub', demo, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_config('t.out', current_setting('t.out') || format(E'%s invitation claimed at sign-in: %s membership(s) created\n',
    case when public.claim_invitations() = 1 then 'PASS' else 'FAIL' end, 1), true);
  execute 'reset role';
  raise exception E'RESULTS (rolled back):\n%', current_setting('t.out');
end $$;
