create function public.my_permissions(p_org uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.code order by p.code), '{}'::text[])
  from public.permissions p
  where p_org in (select private.accessible_orgs(p.code))
$$;
revoke all on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;
