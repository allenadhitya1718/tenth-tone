-- ============================================================
-- 0065_hide_blocked_from_search.sql
--
-- The other half of blocking: hiding the blocked person from the person
-- who blocked them.
--
-- 0054 closed the dangerous direction — a blocked person can no longer read
-- the blocker's profile, so they cannot find them in search. It closed that
-- direction and ONLY that direction, on purpose, and wrote down why:
--
--     "Deliberately ONE-DIRECTIONAL. The person who blocked keeps seeing the
--      person they blocked — they have to, or the Blocked Users screen would
--      be a list of empty rows they could never unblock."
--
-- That reasoning is still right, and it is exactly why the remaining gap
-- cannot be closed the same way. Today, if you block someone, they keep
-- turning up in your search results and your suggested-accounts row. Every
-- comparable app removes them from both. But making the `profiles` policy
-- symmetrical would take the Blocked Users screen down with it, because a
-- row-level policy sees one profile row at a time and cannot know whether it
-- is being read for a search box or for the list of people you have blocked.
--
-- This is the same shape of problem 0055 hit with follower lists:
--
--     "The real problem is that a row-level policy sees one row at a time and
--      cannot know WHOSE LIST is being asked for."
--
-- So the answer is the same answer: move the question to where it can be
-- answered. Three functions that know what they are being asked for, and a
-- profiles policy left exactly as 0054 set it.
--
--   search_profiles()     name/handle search      hides blocks both ways
--   suggested_profiles()  "who to follow"         hides blocks both ways
--   list_blocked()        the Blocked Users list  shows blocks on purpose
--
-- ── On what this is and is not ───────────────────────────
--
-- Hiding the blocker from the blocked person is a SAFETY property, and it
-- stays where safety properties belong: in the RLS policy from 0054, which a
-- direct API call cannot talk its way past.
--
-- Hiding the blocked person from the blocker is a different thing. Nobody is
-- being protected by it — you already know who you blocked, you are the one
-- who typed their name — so it does not need a policy to hold it up. It needs
-- the app to stop putting someone in front of you after you asked it not to.
-- These functions are how the app asks for a list that already excludes them,
-- rather than fetching everyone and hiding some in JavaScript.
--
-- That distinction is why search moves to an RPC instead of the profiles
-- policy getting stricter. Read the two paragraphs above before "simplifying"
-- this into a policy: it has been tried, and it breaks unblocking.
--
-- ── Blast radius, checked before writing this ────────────
--
--   * search screen        blocked accounts disappear from results
--   * discover / suggested blocked accounts disappear from the row
--   * @ mention picker     already correct — search_handles (0035) has
--                          filtered blocks both ways since it was written
--   * follower lists       already correct — list_followers /
--                          list_following (0055) call is_blocked_between
--   * Blocked Users screen unchanged in intent, but see list_blocked below:
--                          it gets STRICTLY better, because a mutual block
--                          no longer makes a row vanish
--   * profile screen       untouched; opening a blocked person's profile by
--                          direct link still works, which is what makes
--                          unblocking from their profile possible
--   * group chats          untouched, matching 0049's decision to leave
--                          groups alone
-- ============================================================


-- ============================================================
-- 1. Searching for people
--
-- Replaces a client-side `profiles` query that filtered nothing:
--
--     .or('name.ilike.%q%,handle.ilike.%q%').limit(20)
--
-- is_blocked_between (0049) is the single source of truth for "these two
-- should not reach each other", in both directions. Using it here rather
-- than rewriting the condition means this cannot drift away from the rest
-- of blocking later.
--
-- p_query is matched with `like`, so the caller's % and _ are escaped here
-- rather than trusted from the app. escape '\' has to be stated explicitly:
-- Postgres has no default escape character for `like`.
-- ============================================================
create or replace function public.search_profiles(
  p_query text,
  p_limit  integer default 30
)
returns table (
  id uuid, name text, handle text, avatar_url text,
  bio text, verified boolean, followers_count integer
)
language sql
security definer
stable
set search_path = public
as $fn$
  -- The three `like` metacharacters are neutralised once, here, and the
  -- surrounding %…% is added afterwards so the wildcards we mean survive.
  -- Backslash must be replaced first or it would escape the escapes.
  with q as (
    select lower(trim(coalesce(p_query, ''))) as needle
  ), esc as (
    select needle,
           '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
      from q
  )
  select p.id, p.name, p.handle, p.avatar_url, p.bio, p.verified, p.followers_count
    from public.profiles p, esc
   where esc.needle <> ''
     and (lower(p.name) like esc.pattern escape '\'
       or lower(p.handle) like esc.pattern escape '\')
     and p.deactivated_at is null
     -- Blocked in either direction: gone from the results.
     and (auth.uid() is null or not public.is_blocked_between(p.id, auth.uid()))
   order by p.followers_count desc nulls last
   limit greatest(1, least(coalesce(p_limit, 30), 50));
$fn$;

revoke all on function public.search_profiles(text, integer) from public;
grant execute on function public.search_profiles(text, integer) to authenticated, anon;


-- ============================================================
-- 2. Suggested accounts
--
-- The Discover row was `profiles order by followers_count desc`, minus
-- yourself. Someone you blocked with a large following sat near the top of
-- it permanently, which is the most visible version of this bug.
-- ============================================================
create or replace function public.suggested_profiles(p_limit integer default 12)
returns table (
  id uuid, name text, handle text, avatar_url text,
  bio text, verified boolean, followers_count integer
)
language sql
security definer
stable
set search_path = public
as $fn$
  select p.id, p.name, p.handle, p.avatar_url, p.bio, p.verified, p.followers_count
    from public.profiles p
   where p.deactivated_at is null
     and (auth.uid() is null or p.id <> auth.uid())
     and (auth.uid() is null or not public.is_blocked_between(p.id, auth.uid()))
   order by p.followers_count desc nulls last
   limit greatest(1, least(coalesce(p_limit, 12), 50));
$fn$;

revoke all on function public.suggested_profiles(integer) from public;
grant execute on function public.suggested_profiles(integer) to authenticated, anon;


-- ============================================================
-- 3. The Blocked Users list
--
-- The app read this by joining profiles from the blocks table and dropping
-- any row whose profile came back null:
--
--     .select('blocked_id, profiles:profiles!blocks_blocked_id_fkey(...)')
--     ...
--     .map(r => r.profiles).filter(Boolean)
--
-- Under 0054's policy that join returns null for anyone who has ALSO blocked
-- you, because their profile is hidden from you. So a mutual block silently
-- disappeared from the list — and the list is the only place to undo it.
-- Blocking someone who had already blocked you made the block permanent
-- from your side.
--
-- SECURITY DEFINER is doing real work here: it is the one place that should
-- see past 0054's policy, because it only ever returns rows you created
-- yourself by blocking someone.
--
-- Returns blocked_at so the newest block can sort to the top.
-- ============================================================
create or replace function public.list_blocked()
returns table (
  id uuid, name text, handle text, avatar_url text, blocked_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $fn$
  select p.id, p.name, p.handle, p.avatar_url, b.created_at
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$fn$;

revoke all on function public.list_blocked() from public;
grant execute on function public.list_blocked() to authenticated;


-- ── Verify after running ─────────────────────────────────
-- All four rows should read OK. Anything else means this file did not
-- finish, or an earlier migration is missing.
select 'search_profiles' as check,
       coalesce(to_regprocedure('public.search_profiles(text,integer)')::text, 'MISSING') as result
union all
select 'suggested_profiles',
       coalesce(to_regprocedure('public.suggested_profiles(integer)')::text, 'MISSING')
union all
select 'list_blocked',
       coalesce(to_regprocedure('public.list_blocked()')::text, 'MISSING')
union all
select 'is_blocked_between exists (0049)',
       case when to_regprocedure('public.is_blocked_between(uuid,uuid)') is null
            then 'RUN 0049 FIRST' else 'OK' end
union all
select 'profiles policy still one-directional (0054)',
       case when exists (
         select 1 from pg_policies
          where tablename = 'profiles' and policyname = 'profiles read public'
            and qual like '%blocks%'
       ) then 'OK' else 'RUN 0054 FIRST' end;

-- Then, signed in as a real user in the SQL editor's session, both of these
-- should come back without the people that user has blocked:
--
--   select * from public.search_profiles('a', 30);
--   select * from public.suggested_profiles(12);
--   select * from public.list_blocked();
--
-- Run as the postgres role they return everyone, because auth.uid() is null
-- there — that is expected, not a failure.
