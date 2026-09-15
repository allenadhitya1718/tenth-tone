-- ============================================================
-- 0083_recount_profile_counters.sql
--
-- A profile showed "2 Followers" and its followers list showed one person.
-- The number comes from profiles.followers_count, a counter a trigger bumps
-- on every follow and unfollow; the list comes from counting rows in
-- public.follows. Two profiles had drifted by exactly one, and one
-- profile's likes_count was off as well.
--
-- The trigger is correct today - tr_follows is row-level, enabled, fires on
-- INSERT and DELETE, and drop_follows_on_block does a plain DELETE that
-- fires it. The drift is historical, from before the mechanism settled. It
-- cannot be un-happened, and a derived counter that is never checked
-- against its source will eventually drift again for some reason nobody
-- predicted.
--
-- So: a recount that touches ONLY rows that disagree with reality, run
-- nightly. On a clean night it updates nothing. The one-off recount that
-- fixed the three drifted rows was this same statement run by hand.
--
-- Deliberately NOT the whole of RECOUNT_STATS.sql: that file also zeroes
-- every share count and recomputes views from engagement rows, which are
-- not "corrections" and must never run unattended.
-- ============================================================

create or replace function public.recount_profile_counters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  with fixed as (
    update public.profiles p
       set followers_count = (select count(*) from public.follows f where f.followed_id = p.id),
           following_count = (select count(*) from public.follows f where f.follower_id = p.id),
           likes_count     = coalesce((select sum(v.likes_count) from public.videos v where v.user_id = p.id), 0)
     where p.followers_count <> (select count(*) from public.follows f where f.followed_id = p.id)
        or p.following_count <> (select count(*) from public.follows f where f.follower_id = p.id)
        or p.likes_count     <> coalesce((select sum(v.likes_count) from public.videos v where v.user_id = p.id), 0)
    returning 1
  )
  select count(*) into n from fixed;
  return n;
end;
$$;

revoke all on function public.recount_profile_counters() from public, anon, authenticated;
grant execute on function public.recount_profile_counters() to service_role;

-- 03:45 nightly, after the deletion purge at 03:30 so it sees the final state.
-- Unschedule first so this file is safe to re-run.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - function created, nothing scheduled';
    return;
  end if;
  begin perform cron.unschedule('recount-profile-counters'); exception when others then null; end;
  perform cron.schedule('recount-profile-counters', '45 3 * * *',
                        'select public.recount_profile_counters()');
end $$;
