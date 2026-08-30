-- ============================================================
-- 0054_block_visibility_and_private_lists.sql
--
-- The two gaps 0049 deliberately left open, now closed.
--
--   1. A blocked person could still open your profile and read your name,
--      photo, bio and counts. Instagram hides it entirely.
--   2. A private account's follower and following LISTS were readable by
--      anyone, so a stranger could see exactly who someone follows while
--      being shown none of their posts.
--
-- Both were left out of 0049 because profiles and follows are read from a
-- great many places and restricting them carelessly makes people render as
-- blanks in screens that have nothing to do with blocking. This migration
-- takes them one at a time, with the blast radius written down.
-- ============================================================


-- ============================================================
-- 1. A blocked person cannot see the blocker's profile
--
-- Deliberately ONE-DIRECTIONAL. The person who blocked keeps seeing the
-- person they blocked — they have to, or the Blocked Users screen would be
-- a list of empty rows they could never unblock.
--
-- What this affects, checked before writing it:
--   * search              a blocked person no longer finds the blocker
--   * profile screen      shows the "user not found" empty state
--   * comment authors     the blocker's comments lose their name for the
--                         blocked person, which is the intended effect
--   * group chats         the blocker's name disappears for the blocked
--                         person; both remain in the group
--   * follower lists      the blocker is absent from lists the blocked
--                         person can see
--
-- Counts stored on other rows (followers_count and so on) are unaffected,
-- exactly as on Instagram: you may still see a number you cannot expand.
-- ============================================================

drop policy if exists "profiles read public" on public.profiles;
create policy "profiles read public" on public.profiles
  for select to authenticated, anon
  using (
    -- Always your own row.
    id = auth.uid()
    -- Signed out: nothing to block against.
    or auth.uid() is null
    -- Otherwise: hidden if THIS profile's owner has blocked the viewer.
    or not exists (
      select 1 from public.blocks b
       where b.blocker_id = profiles.id
         and b.blocked_id = auth.uid()
    )
  );

-- The lookup above runs per row, and blocker_id alone does not lead any
-- existing index — blocks' primary key is (blocker_id, blocked_id), which
-- does lead with it, so this is already covered. Named here so the next
-- person does not have to work that out again.


-- ============================================================
-- 2. Follower and following lists follow the account's privacy
--
-- follows was `using (true)`. Now a follow row is visible when:
--   * you are either side of it, or
--   * you could see that person's posts anyway.
--
-- can_see_posts_of() already encodes "public, or private and you follow
-- them", and since 0049 it also refuses across a block — so this inherits
-- both rules rather than restating them and letting them drift apart.
--
-- It is SECURITY DEFINER, so it does not re-enter this policy.
--
-- Note what is NOT hidden: followers_count on the profile. A private
-- account still shows "120 followers"; you simply cannot open the list.
-- That matches Instagram, and it is why the counters are denormalised.
-- ============================================================

drop policy if exists "follows read public" on public.follows;
create policy "follows read public" on public.follows
  for select to authenticated, anon
  using (
    follower_id = auth.uid()
    or followed_id = auth.uid()
    or (
      public.can_see_posts_of(followed_id, auth.uid())
      and public.can_see_posts_of(follower_id, auth.uid())
    )
  );


-- ── Check ────────────────────────────────────────────────
select 'profiles policy updated' as check,
       case when exists (
         select 1 from pg_policies
          where tablename = 'profiles' and policyname = 'profiles read public'
            and qual like '%blocks%'
       ) then 'OK' else 'NOT APPLIED' end as result
union all
select 'follows policy updated',
       case when exists (
         select 1 from pg_policies
          where tablename = 'follows' and policyname = 'follows read public'
            and qual like '%can_see_posts_of%'
       ) then 'OK' else 'NOT APPLIED' end
union all
select 'can_see_posts_of checks blocks (0049)',
       case when exists (
         select 1 from pg_proc
          where proname = 'can_see_posts_of'
            and prosrc like '%is_blocked_between%'
       ) then 'OK' else 'RUN 0049 FIRST' end;
