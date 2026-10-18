-- ============================================================
-- 0098_search_strips_at.sql
-- Searching "@sara" finds sara.
--
-- Client note 30: typing a handle the way it is displayed, with its @,
-- returned nothing. Handles are stored WITHOUT the @ (the app adds it only
-- for display), and search_profiles() (0065) matched the query as typed, so
-- "@sara" became the pattern %@sara% and no handle or name contains that.
--
-- The fix is to strip leading @ characters, and the whitespace around them,
-- from the query before it is matched. "@sara", " @sara ", "@@sara" and
-- "@ sara" all search for "sara". A query that is nothing but @ signs
-- becomes empty and returns no rows, exactly like an empty query today.
--
-- Only an @ at the START is removed. An @ in the middle of the query is
-- still matched literally, as before.
--
-- The new mobile app already strips the @ before calling; this makes the
-- server do it too, so the web app (and any other caller) is fixed without a
-- client release.
--
-- Everything else is copied from 0065 unchanged: the signature, the return
-- columns, the like-escaping, the deactivated filter, the two-way block
-- filter through is_blocked_between() (0049), the ordering, the limit clamp
-- and the grants. search_handles() (0035, the @ mention picker) is not
-- touched; it is given the text after the @ already.
--
-- Apply in the Supabase SQL editor AFTER 0001..0097. Safe to re-run.
-- ============================================================

begin;

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
  --
  -- 0098: leading @ signs are dropped before anything else, with the
  -- whitespace on either side of them, because handles are stored without
  -- the @ that the app displays.
  with q as (
    select lower(trim(ltrim(trim(coalesce(p_query, '')), '@'))) as needle
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

commit;


-- ── Verify after running ──
-- Should read OK. Then, signed in, these two should return the same rows:
--
--   select * from public.search_profiles('sara', 30);
--   select * from public.search_profiles('@sara', 30);
--
-- and this one none:
--
--   select * from public.search_profiles('@', 30);
select 'search_profiles strips a leading @' as check,
       case when pg_get_functiondef('public.search_profiles(text,integer)'::regprocedure)
                 like '%ltrim(%''@'')%'
            then 'OK' else 'NOT UPDATED' end as result;
