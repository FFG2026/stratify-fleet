-- Records that an administrator created a login (with a temporary password) for a person. The password is never stored or logged.
create function public.record_member_login(p_org uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_permission(p_org, 'membership.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform private.write_audit(p_org, 'member.login_created', 'member', null, null,
    jsonb_build_object('email', lower(btrim(p_email)), 'must_change_password', true));
end $$;

revoke all on function public.record_member_login(uuid, text) from public, anon;
grant execute on function public.record_member_login(uuid, text) to authenticated;
