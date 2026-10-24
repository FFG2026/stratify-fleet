-- Cover cannot be recorded retroactively within the day.
-- Before this, "starts today" meant 00:00 today, so a vehicle added at 3pm was covered from midnight. A fleet can now only
-- start or end cover from the moment it is recorded (two minutes of slack for slow forms) or later. Only a role with
-- coverage.backdate (insurer admins) can record an earlier time. coverage_periods.created_at (set by the database, immutable)
-- is the permanent record of when each vehicle was actually added.
create function private.guard_cover_timing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return new; end if;  -- migrations and the platform itself; users always have a uid
  if tg_op = 'INSERT' then
    if new.cover_start < now() - interval '2 minutes' and not private.has_permission(new.fleet_id, 'coverage.backdate') then
      raise exception 'cover cannot start earlier than the moment it is recorded; choose now or a later time' using errcode = '42501';
    end if;
  elsif new.cover_end is not null and new.cover_end is distinct from old.cover_end
        and new.cover_end < now() - interval '2 minutes' and not private.has_permission(new.fleet_id, 'coverage.backdate') then
    raise exception 'cover cannot end earlier than the moment it is recorded; choose now or a later time' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger coverage_periods_timing before insert or update on public.coverage_periods
  for each row execute function private.guard_cover_timing();
