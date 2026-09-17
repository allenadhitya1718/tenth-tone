-- 0085 — follower counts that cannot drift
--
-- Reported five times: follow someone and their count goes up; unfollow and
-- it does not come back down. Audited on 2026-09-17 after the 03:45 recount
-- had already run: five profiles were over by one or two within the day.
--
-- The cause is a rights mismatch, not arithmetic. bump_follow_counts() runs
-- as the CALLER. A follow goes through follow_or_request(), which is
-- SECURITY DEFINER, so its "+1" on the other person's profile row succeeds.
-- An unfollow is a plain DELETE from the app as the user — and the trigger's
-- "-1" on the OTHER person's row is then filtered out by row-level security
-- ("profiles update own": auth.uid() = id). Zero rows updated, no error.
-- Follows count up; unfollows never count down.
--
-- Two changes:
--   1. The trigger runs SECURITY DEFINER, so both sides of every follow and
--      unfollow reach both profiles. guard_profile_privileges() already lets
--      trigger-depth updates through, so nothing else needs to change.
--   2. It no longer adds and subtracts. It SETS each counter to the real
--      count of rows for the two profiles involved. That is one indexed
--      count per profile per event, and it is self-healing: whatever the
--      counter said before, it is correct after the next follow or unfollow.
--
-- The nightly recount_profile_counters() stays as a backstop.

create or replace function public.bump_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_follower uuid := coalesce(new.follower_id, old.follower_id);
  v_followed uuid := coalesce(new.followed_id, old.followed_id);
begin
  update public.profiles p
     set following_count = (select count(*) from public.follows f where f.follower_id = p.id)
   where p.id = v_follower;
  update public.profiles p
     set followers_count = (select count(*) from public.follows f where f.followed_id = p.id)
   where p.id = v_followed;
  return null;
end;
$$;

revoke all on function public.bump_follow_counts() from public;

-- Put every profile right now, not tonight.
select public.recount_profile_counters();
