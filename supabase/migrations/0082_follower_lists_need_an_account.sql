-- 0082 — signed-out visitors can enumerate any public account's followers
--
-- Run this whole file once in the Supabase SQL editor. Safe to re-run.
--
-- 0055 created list_followers / list_following and clearly meant them to be
-- for signed-in users only. It ended with:
--
--     revoke all on function public.list_followers(uuid) from public;
--     grant execute on function public.list_followers(uuid) to authenticated;
--
-- That revoke does nothing on Supabase. When a function is created, Supabase's
-- default privileges grant EXECUTE to `anon` and `authenticated` EXPLICITLY,
-- as those roles — not through PUBLIC. Revoking from PUBLIC removes a grant
-- that was never the one being used, `anon` keeps its own, and the revoke
-- reports success.
--
-- This is the third time the same trap has appeared in this project. 0073
-- found it on destructive functions and 0075 found it on column privileges;
-- the fix each time is to name the role rather than PUBLIC.
--
-- Verified against the live database: a request carrying only the publishable
-- key and no session returned 200 with the full follower list of a public
-- account. So anyone who reads the app's JavaScript — where that key lives,
-- correctly, because it is public by design — can enumerate who follows any
-- public account without ever creating an account.
--
-- Scope of the leak, stated honestly:
--   * PRIVATE accounts were never exposed. can_see_posts_of(owner, null)
--     fails its private branch for a null viewer, so those return no rows.
--   * Only public accounts' follower and following lists were readable.
--   * The counts were already public on the profile, but the LIST of people
--     is a different thing: it maps out who knows whom.
--
-- No part of the app needs anonymous access to these. /list/... is not in
-- PUBLIC_PATHS, so every caller is signed in by the time it runs.

revoke execute on function public.list_followers(uuid) from anon;
revoke execute on function public.list_following(uuid) from anon;

-- Say it explicitly rather than relying on what happens to be there. A later
-- create-or-replace would re-grant anon by default, so anyone editing these
-- functions in future must re-run this file.
grant execute on function public.list_followers(uuid) to authenticated;
grant execute on function public.list_following(uuid) to authenticated;


-- ── Verify ──
-- has_function_privilege answers as the named role, which is what matters -
-- not what the grant statements looked like.
select 'anon cannot list followers' as check,
       case when not has_function_privilege('anon', 'public.list_followers(uuid)', 'execute')
            then 'OK' else 'STILL EXECUTABLE BY anon' end as result
union all
select 'anon cannot list following',
       case when not has_function_privilege('anon', 'public.list_following(uuid)', 'execute')
            then 'OK' else 'STILL EXECUTABLE BY anon' end
union all
select 'signed-in users still can (followers)',
       case when has_function_privilege('authenticated', 'public.list_followers(uuid)', 'execute')
            then 'OK' else 'BROKEN - the app cannot read follower lists' end
union all
select 'signed-in users still can (following)',
       case when has_function_privilege('authenticated', 'public.list_following(uuid)', 'execute')
            then 'OK' else 'BROKEN - the app cannot read following lists' end
order by 1;

-- After running: open a follower list in the app while signed in. It must
-- still work. If it does not, the third or fourth check above will say so.
