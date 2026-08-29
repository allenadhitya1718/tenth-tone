-- ============================================================
-- 0032_location_safety.sql
--
-- Live location is the most sensitive thing this app stores, and it had no
-- notion of time. A position written once stayed readable forever, so
-- someone who shared their location a year ago and never came back was
-- still pinned to the map at wherever they last stood.
--
--   * a shared location goes stale after 8 hours and stops being readable
--   * rows older than 7 days are deleted outright
--   * turning sharing off blanks the coordinates rather than just hiding them
--
-- Apply in the Supabase SQL editor AFTER 0001..0031.
-- ============================================================

create index if not exists idx_user_locations_updated
  on public.user_locations (updated_at desc);


-- ── Reading someone's location ──
-- Same rules as before (public / self / approved follower) with two additions:
-- sharing must be on, and the fix must be recent. Enforced in the policy, so
-- a stale position is not merely hidden by the app - it cannot be selected.
drop policy if exists "locations read" on public.user_locations;
create policy "locations read" on public.user_locations
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      coalesce(sharing_enabled, false) = true
      and updated_at > now() - interval '8 hours'
      and not exists (
        select 1 from public.blocks
        where (blocker_id = user_id and blocked_id = auth.uid())
           or (blocker_id = auth.uid() and blocked_id = user_id)
      )
      and (
        visibility = 'public'
        or (
          visibility = 'friends'
          and exists (
            select 1 from public.follows
            where follower_id = auth.uid() and followed_id = user_id
          )
        )
      )
    )
  );


-- ── Turning sharing off removes the coordinates ──
-- Flipping a boolean while the last known position sits in the row is not
-- really stopping sharing. This clears the point itself.
create or replace function public.clear_location_when_off()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(new.sharing_enabled, false) = false or new.visibility = 'none' then
    new.lat := null;
    new.lng := null;
    new.accuracy := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_clear_location_when_off on public.user_locations;
create trigger trg_clear_location_when_off
  before insert or update on public.user_locations
  for each row execute function public.clear_location_when_off();


-- ── Stop sharing, from the app ──
create or replace function public.stop_sharing_location()
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.user_locations
     set sharing_enabled = false, visibility = 'none',
         lat = null, lng = null, accuracy = null, updated_at = now()
   where user_id = auth.uid();
$fn$;

grant execute on function public.stop_sharing_location() to authenticated;


-- ── Housekeeping ──
-- Nothing keeps a week-old position useful, and holding it is a liability.
-- Call from a scheduled job (pg_cron) if available, or from an operator task.
create or replace function public.purge_stale_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  delete from public.user_locations
   where updated_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.purge_stale_locations() from public;
grant execute on function public.purge_stale_locations() to service_role;

-- Runs nightly where pg_cron is enabled; harmless where it is not.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-stale-locations')
      where exists (select 1 from cron.job where jobname = 'purge-stale-locations');
    perform cron.schedule('purge-stale-locations', '0 3 * * *',
                          'select public.purge_stale_locations()');
  end if;
end
$cron$;
