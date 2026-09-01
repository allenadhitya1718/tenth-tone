-- 0075 — finish what 0074's column revoke could not
--
-- Run this whole file once in the Supabase SQL editor. Safe to re-run.
--
-- 0074 tried:
--   revoke select (is_admin, banned_until, deactivated_at, deletion_scheduled_at)
--     on public.profiles from anon;
--
-- and its own verify step reported STILL READABLE. The reason is a Postgres
-- rule that is easy to miss: a column-level REVOKE does nothing while the role
-- still holds a TABLE-level SELECT. The table grant is the wider right and it
-- keeps applying; the revoke removed a column grant that was never what
-- authorised the read.
--
-- Exactly the shape of the mistake 0073 fixed: a statement that names the right
-- object, raises nothing, and changes nothing. Worth noticing that it took a
-- verify query to catch it here too - the SQL looked correct both times.
--
-- So: drop the table-level grant and re-grant an explicit column list. That
-- also fails safe in future - a column added later is NOT readable by anonymous
-- visitors until somebody deliberately adds it here.

revoke select on public.profiles from anon;

grant select (
  id,
  handle,
  name,
  bio,
  avatar_url,
  verified,
  followers_count,
  following_count,
  likes_count,
  created_at,
  updated_at,
  guidelines_accepted_at,
  is_private,
  link
) on public.profiles to anon;

-- Deliberately NOT granted to anon:
--   is_admin               - the admin roster was enumerable by anyone
--   banned_until           - every banned account, listable
--   deactivated_at         - who has hidden themselves
--   deletion_scheduled_at  - who is queued for deletion
--
-- `authenticated` is untouched: the app and the admin panel both run as that
-- role and still read the full row, subject to the existing RLS policy.


-- ── Verify ──
select 'anon cannot read is_admin' as check,
       case when not exists (
         select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'profiles'
            and grantee = 'anon' and privilege_type = 'SELECT' and column_name = 'is_admin'
       ) then 'OK' else 'STILL READABLE' end as result
union all
select 'anon cannot read the lifecycle columns',
       case when not exists (
         select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'profiles'
            and grantee = 'anon' and privilege_type = 'SELECT'
            and column_name in ('banned_until','deactivated_at','deletion_scheduled_at')
       ) then 'OK' else 'STILL READABLE' end
union all
select 'anon CAN still read handle (signed-out browsing)',
       case when exists (
         select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'profiles'
            and grantee = 'anon' and privilege_type = 'SELECT' and column_name = 'handle'
       ) then 'OK' else 'BROKEN — signed-out browsing will fail' end
union all
select 'authenticated still reads everything',
       case when (
         select count(*) from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'profiles'
            and grantee = 'authenticated' and privilege_type = 'SELECT'
       ) >= 14 or exists (
         select 1 from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'profiles'
            and grantee = 'authenticated' and privilege_type = 'SELECT'
       ) then 'OK' else 'CHECK THE APP' end
order by 1;

-- After running, confirm from outside with the publishable key:
--   /rest/v1/profiles?select=handle           -> 200, rows
--   /rest/v1/profiles?select=is_admin         -> 401/permission denied
