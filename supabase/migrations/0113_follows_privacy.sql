-- 0113 - a follow is asked for, not taken; and "Friends" on the map means
-- friends
--
-- Security review 2026-10, finding F01 (critical). Apply after 0112. Safe to
-- re-run.
--
-- ============================================================
-- 1. ANYONE COULD FOLLOW A PRIVATE ACCOUNT WITHOUT ASKING
-- ============================================================
-- "follows insert own" (0001) is
--     for insert to authenticated with check (auth.uid() = follower_id)
-- and nothing ever replaced it. follow_or_request() (0030) is what turns a
-- follow of a private account into a request, but it is only the path the
-- app TAKES; a direct POST /rest/v1/follows {follower_id: me, followed_id:
-- <private account>} skipped it and created the follow outright. Everything
-- that trusts "is a follower" then opened up:
--   * can_see_posts_of() (0030): the private account's posts,
--   * stories 'followers' audience (0102), lives with privacy 'friends' (0004),
--   * user_locations 'friends' visibility (0105): the live GPS position.
--
-- Now there is no client insert into follows at all. follow_or_request()
-- (public account -> follows, private account -> follow_requests) and
-- approve_follow_request() are SECURITY DEFINER and keep working; they are
-- the only writers. Both apps call follow_or_request first and only fall back
-- to a direct insert when the RPC does not exist (pre-0030), which it does.
-- Unfollow (delete own row) is unchanged.
--
-- Follows created through the hole before this file cannot be told apart
-- from approved ones and are left alone. A private account owner can remove
-- a follower they do not recognise.

drop policy if exists "follows insert own" on public.follows;
revoke insert, update on public.follows from anon, authenticated;

-- Approve / request paths are SECURITY DEFINER and owned by the table owner,
-- so they bypass RLS and the revoke above. Restated grants for clarity.
grant execute on function public.follow_or_request(uuid)      to authenticated;
grant execute on function public.approve_follow_request(uuid) to authenticated;


-- ============================================================
-- 2. "FRIENDS" ON THE MAP MEANT "ANYONE WHO FOLLOWS ME"
-- ============================================================
-- The settings screen says Friends are "people you follow who follow you
-- back" (0097's definition: a mutual follow). The location read policy
-- (0105) only checked that the VIEWER follows the owner, so for a public
-- account any stranger could press Follow and read the live position. Now
-- both follows must exist. Everything else is 0105's policy verbatim: own
-- row, sharing switch, 8-hour freshness, block in either direction, public
-- visibility, and an approved, unexpired permit.

drop policy if exists "locations read" on public.user_locations;
create policy "locations read" on public.user_locations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      coalesce(sharing_enabled, false) = true
      and updated_at > now() - interval '8 hours'
      and not public.is_blocked_between(user_locations.user_id, (select auth.uid()))
      and (
        visibility = 'public'
        or (
          visibility = 'friends'
          and exists (
            select 1 from public.follows
            where follower_id = (select auth.uid()) and followed_id = user_locations.user_id
          )
          and exists (
            select 1 from public.follows
            where follower_id = user_locations.user_id and followed_id = (select auth.uid())
          )
        )
        or exists (
          select 1 from public.location_permits lp
          where lp.target_id = user_locations.user_id
            and lp.requester_id = (select auth.uid())
            and lp.status = 'approved'
            and (lp.expires_at is null or lp.expires_at > now())
        )
      )
    )
  );


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'no client insert policy on follows' as check,
       case when not exists (select 1 from pg_policies
                              where schemaname = 'public' and tablename = 'follows'
                                and cmd in ('INSERT', 'ALL'))
            then 'OK' else 'STILL OPEN' end as result
union all
select 'authenticated cannot insert into follows',
       case when not has_table_privilege('authenticated', 'public.follows', 'insert')
            then 'OK' else 'STILL OPEN' end
union all
select 'follow_or_request callable',
       case when has_function_privilege('authenticated', 'public.follow_or_request(uuid)', 'execute')
            then 'OK' else 'BROKEN - nobody can follow' end
union all
select 'follow_or_request is security definer',
       case when (select prosecdef from pg_proc where oid = 'public.follow_or_request(uuid)'::regprocedure)
            then 'OK' else 'BROKEN - follows cannot be written' end
union all
select 'locations read requires a mutual follow for friends',
       case when (select (length(e) - length(replace(e, 'follower_id', ''))) / length('follower_id')
                    from (select pg_get_expr(polqual, polrelid) as e from pg_policy
                           where polrelid = 'public.user_locations'::regclass
                             and polname = 'locations read') q) >= 2
            then 'OK' else 'NOT UPDATED' end
order by 1;

-- Behavioural test, two accounts A (private) and B:
--   as B: insert into follows (follower_id, followed_id) values (B, A);  -- must fail (42501)
--   as B: select follow_or_request(A);                                   -- 'requested'
