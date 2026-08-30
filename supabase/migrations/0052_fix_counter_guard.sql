-- ============================================================
-- 0052_fix_counter_guard.sql   ***  REGRESSION FROM 0048  ***
--
-- 0048 added guard_profile_privileges() to stop a user writing their own
-- is_admin, verified, banned_until and the denormalised counters. The
-- privilege half was right. The counter half broke following.
--
-- followers_count / following_count / likes_count are not written by people
-- — they are written by bump_follow_counts() (0001), an AFTER trigger on
-- follows that issues an UPDATE against profiles. That UPDATE fires the new
-- BEFORE UPDATE guard, which sees a non-admin and reverts the value it just
-- set. So follows succeeded and the counts never moved: every profile sat
-- at 0 followers no matter what.
--
-- The guard could not tell "this user is faking their follower count" from
-- "the counter trigger is doing its job", because both arrive as an UPDATE
-- on profiles from the same non-admin session.
--
-- pg_trigger_depth() distinguishes them. Fired directly by a user's own
-- statement the depth is 1; fired from inside another trigger's UPDATE it
-- is 2 or more. So a counter change is allowed only when something else in
-- the database is driving it, and never when it comes straight from a
-- client.
--
-- The privilege columns stay locked at every depth. There is no legitimate
-- trigger that grants admin, and leaving a hole for one would undo 0048.
-- ============================================================

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Privilege and moderation state: only an admin may ever change these,
  -- at any nesting depth.
  if not public.is_admin() then
    new.is_admin       := old.is_admin;
    new.verified       := old.verified;
    new.banned_until   := old.banned_until;
    new.deactivated_at := old.deactivated_at;
  end if;

  -- Counters: maintained by triggers, never by a person. Allowed through
  -- when the update originates inside another trigger; reverted when it
  -- arrives directly from a client.
  if not public.is_admin() and pg_trigger_depth() <= 1 then
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.likes_count     := old.likes_count;
  end if;

  return new;
end;
$$;


-- ── Repair the counts that drifted while the guard was wrong ──
-- Any follow, unfollow or like between 0048 and this migration failed to
-- move its counter. Recomputed from the rows themselves, which are the
-- truth — the counters are only ever a cache of these.
update public.profiles p
   set followers_count = (select count(*) from public.follows f where f.followed_id = p.id),
       following_count = (select count(*) from public.follows f where f.follower_id = p.id),
       likes_count     = (select count(*)
                            from public.likes l
                            join public.videos v on v.id = l.video_id
                           where v.user_id = p.id);


-- ── Prove it works, rather than assuming ─────────────────
-- Reports any profile whose stored counter disagrees with reality. Should
-- return no rows.
select p.id, p.handle,
       p.followers_count as stored_followers,
       (select count(*) from public.follows f where f.followed_id = p.id) as real_followers
  from public.profiles p
 where p.followers_count <> (select count(*) from public.follows f where f.followed_id = p.id);
