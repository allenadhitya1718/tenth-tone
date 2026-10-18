-- 0124 - who is an admin, who is banned and who is leaving is nobody else's
-- business
--
-- Security review 2026-10, round 2: F16. Apply after 0123. Safe to re-run.
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). The React Native app is the only
-- client of this project and lists its profile columns explicitly (mobile
-- src/api/profiles.ts PROFILE_COLUMNS). The old web/Capacitor app
-- (web/js/supabase.js -> qnzgxihlrwanywndcmpf) still does select('*') on
-- profiles and reads is_admin directly; applying this file THERE would break
-- its profile screens and admin panel. Do not apply it to the old project.
--
-- ============================================================
-- F16 - EVERY SIGNED-IN USER COULD READ EVERYONE'S ACCOUNT STATE
-- ============================================================
-- 0074/0075 limited anon to a column list, but authenticated kept table-wide
-- SELECT on profiles, so any account could list
--     select=handle,is_admin&is_admin=eq.true          (the admins)
--     banned_until, deactivated_at, deletion_scheduled_at
--                                                      (who is banned / leaving)
--
-- Now authenticated gets SELECT on every profiles column EXCEPT those four.
-- Your own values stay available through SECURITY DEFINER paths that answer
-- only for auth.uid(): is_admin() (0002) and my_account_status() (0034).
-- SECURITY DEFINER functions, triggers and the service role are unaffected.
--
-- Four policies read those columns AS THE QUERYING USER, and a policy that
-- references a column the role cannot select makes the whole query fail for
-- everyone (not just non-admins). They are rewritten first to go through
-- definer helpers:
--   app_limits   "app_limits admin write"      (0031) -> is_admin()
--   support      "support read own or admin"   (0033) -> is_admin()
--   support      "support admin update"        (0033) -> is_admin()
--   live_streams "live insert own"             (0038) -> may_go_live()
--
-- NOTE FOR LATER MIGRATIONS: a column added to profiles after this file is
-- NOT readable by authenticated until it is granted explicitly
-- (grant select (new_col) on public.profiles to authenticated).

begin;

-- ── 1. Policies that read the private columns, rewritten ────────────────

create or replace function public.may_go_live()
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  -- Same not-banned / not-deactivated test the feed and upload paths use.
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.banned_until is null or p.banned_until <= now())
       and p.deactivated_at is null
  );
$fn$;
revoke all on function public.may_go_live() from public, anon;
grant execute on function public.may_go_live() to authenticated;

drop policy if exists "live insert own" on public.live_streams;
create policy "live insert own" on public.live_streams
  for insert to authenticated
  with check (auth.uid() = host_id and public.may_go_live());

drop policy if exists "app_limits admin write" on public.app_limits;
create policy "app_limits admin write" on public.app_limits
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "support read own or admin" on public.support_tickets;
create policy "support read own or admin" on public.support_tickets
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "support admin update" on public.support_tickets;
create policy "support admin update" on public.support_tickets
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── 2. Column-level SELECT for authenticated ────────────────────────────
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('is_admin', 'banned_until', 'deactivated_at', 'deletion_scheduled_at');

  revoke select on public.profiles from authenticated;
  execute format('grant select (%s) on public.profiles to authenticated', v_cols);
end $$;

-- anon was already limited by 0075; make sure none of the four slipped back.
revoke select (is_admin, banned_until, deactivated_at, deletion_scheduled_at)
  on public.profiles from anon;

-- Self-only paths the app uses for its own state.
grant execute on function public.is_admin()          to authenticated;
grant execute on function public.my_account_status() to authenticated;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'authenticated cannot read ' || c as check,
       case when not has_column_privilege('authenticated', 'public.profiles', c, 'select')
            then 'OK' else 'STILL READABLE' end as result
  from unnest(array['is_admin', 'banned_until', 'deactivated_at', 'deletion_scheduled_at']) as c
union all
select 'authenticated can read ' || c,
       case when has_column_privilege('authenticated', 'public.profiles', c, 'select')
            then 'OK' else 'BROKEN - the app reads this column' end
  from unnest(array['id', 'handle', 'name', 'bio', 'avatar_url', 'verified', 'followers_count',
                    'following_count', 'likes_count', 'created_at', 'updated_at',
                    'guidelines_accepted_at', 'is_private', 'link']) as c
union all
select 'no policy reads the private columns as the user',
       case when not exists (
         select 1 from pg_policies
          where schemaname in ('public', 'storage')
            and (coalesce(qual, '') ~ '\m(is_admin|banned_until|deactivated_at|deletion_scheduled_at)\M(?!\s*\()'
              or coalesce(with_check, '') ~ '\m(is_admin|banned_until|deactivated_at|deletion_scheduled_at)\M(?!\s*\()'))
            then 'OK' else 'A POLICY STILL READS ONE - it fails for everyone' end
order by 1;
