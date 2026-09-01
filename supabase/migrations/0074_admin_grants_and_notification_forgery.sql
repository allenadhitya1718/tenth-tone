-- 0074 — the rest of the privilege surface
--
-- Run this whole file once in the Supabase SQL editor. Safe to re-run.
--
-- 0073 fixed a NAMED LIST of functions. This is the part that list missed, plus
-- two policy holes found in the same audit.
--
-- ============================================================
-- 1. EVERY admin_* RPC IS STILL EXECUTE-GRANTED TO anon
-- ============================================================
-- Probed unauthenticated with the publishable key that ships in the app. The
-- distinction that matters is WHICH layer refused:
--
--   401 42501 permission denied    -> the ACL stopped it
--   400 P0001 'forbidden'          -> the ACL let it through and the function's
--                                     OWN body stopped it
--
-- Measured: admin_queue_counts, admin_storage_overview, admin_user_detail,
-- admin_adjust_wallet, admin_delete_user, admin_cancel_deletion and
-- admin_unhide_content all returned P0001 - the bodies RAN. admin_pending_
-- deletions, admin_growth and admin_moderation_recent returned 200 with an
-- empty array.
--
-- Every one of them fails closed today, because each carries its own
-- `if not public.is_admin()`. But the only thing between an anonymous caller
-- and `delete from auth.users` is that one line, with the ACL contributing
-- nothing. This project has already proved that layer can silently be absent:
-- purge_orphaned_auth_users(), which bulk-deletes accounts and has NO is_admin
-- check at all, was reachable for 34 migrations until 0073.
--
-- Defence in depth means the ACL refuses first.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'admin\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- admin_stats is the one with no in-body guard at all (0002), granted to
-- authenticated - so ANY signed-up account could read total_users,
-- total_videos, pending_reports and the day's gift revenue. It was safe from
-- anon only because 0002 happened to name anon in its revoke.
create or replace function public.admin_stats()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select case when public.is_admin() then json_build_object(
    'total_users',        (select count(*) from public.profiles),
    'users_today',        (select count(*) from public.profiles where created_at::date = current_date),
    'total_videos',       (select count(*) from public.videos where is_draft = false),
    'videos_today',       (select count(*) from public.videos where is_draft = false and created_at::date = current_date),
    'pending_reports',    (select count(*) from public.reports where status = 'pending'),
    'live_now',           (select count(*) from public.live_streams where status = 'live'),
    'gifts_today',        (select count(*) from public.gift_transactions where created_at::date = current_date),
    'gift_revenue_today', (select coalesce(sum(amount), 0) from public.gift_transactions where created_at::date = current_date)
  ) end;
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;


-- ============================================================
-- 2. ANY SIGNED-IN USER COULD FORGE AN OFFICIAL ANNOUNCEMENT
-- ============================================================
-- 0002's policy reads:
--
--   with check (public.is_admin() or auth.uid() = actor_id)
--
-- The second branch constrains NOTHING about user_id, type or payload. So any
-- authenticated account could insert a notification aimed at anyone, with
-- type 'system' - which the type constraint allows - and an arbitrary
-- {title, body}.
--
-- This got worse today, not better: the notifications screen previously had no
-- branch for {title, body} and rendered every such row as the generic fallback
-- "تحديث جديد". Teaching it to render title and body properly - which it had to
-- do, because real admin broadcasts were arriving blank - also made a forged
-- one look exactly like a real announcement from FLYP.
--
-- Ordinary users never insert notifications directly. Every legitimate one is
-- written by a SECURITY DEFINER trigger, which bypasses RLS entirely and is
-- unaffected by this.

drop policy if exists "admins insert notifs" on public.notifications;
create policy "admins insert notifs" on public.notifications
  for insert to authenticated
  with check (public.is_admin());


-- ============================================================
-- 3. ANON COULD ENUMERATE ADMINS AND ACCOUNT LIFECYCLE STATE
-- ============================================================
-- `profiles read public` is `using (true)` with no column list, so an
-- unauthenticated request could ask for is_admin and get the roster:
--
--   GET /rest/v1/profiles?select=handle,is_admin&is_admin=eq.true  -> 200, 2 rows
--
-- select=* also returned banned_until, deactivated_at and deletion_scheduled_at
-- - every banned account and every account queued for deletion, to anyone.
-- Combined with the admin-panel XSS fixed in the same pass, that was a named
-- target list.
--
-- Column-level revoke rather than a policy change: the row policy is correct
-- and signed-out browsing depends on it. The admin panel runs as authenticated
-- and is unaffected.
revoke select (is_admin, banned_until, deactivated_at, deletion_scheduled_at)
  on public.profiles from anon;


-- ============================================================
-- VERIFY — every row should read OK
-- ============================================================
select 'no admin_* function is callable by anon' as check,
       case when not exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join lateral aclexplode(p.proacl) a
           join pg_roles r on r.oid = a.grantee
          where n.nspname = 'public' and r.rolname = 'anon' and p.proname like 'admin\_%'
       ) then 'OK' else 'STILL EXPOSED' end as result
union all
select 'admin_stats now checks is_admin',
       case when pg_get_functiondef('public.admin_stats()'::regprocedure) like '%is_admin()%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'only admins may insert notifications',
       case when pg_get_expr(polwithcheck, polrelid) = '(is_admin())'
              or pg_get_expr(polwithcheck, polrelid) like '%is_admin()%'
             and pg_get_expr(polwithcheck, polrelid) not like '%actor_id%'
            then 'OK' else 'STILL FORGEABLE' end
  from pg_policy
 where polrelid = 'public.notifications'::regclass and polname = 'admins insert notifs'
union all
select 'anon cannot read is_admin / lifecycle columns',
       case when not exists (
         select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'profiles'
            and grantee = 'anon' and privilege_type = 'SELECT'
            and column_name in ('is_admin','banned_until','deactivated_at','deletion_scheduled_at')
       ) then 'OK' else 'STILL READABLE' end
union all
select 'anon can still read ordinary profile columns',
       case when exists (
         select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'profiles'
            and grantee = 'anon' and privilege_type = 'SELECT' and column_name = 'handle'
       ) then 'OK' else 'BROKEN — signed-out browsing will fail' end
order by 1;
