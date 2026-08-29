-- =============================================================
-- 0039  Account deletion actually removes the login
--
-- profiles.id references auth.users(id) on delete cascade, so deleting
-- the auth user removes everything. Deleting the profile does not work
-- in reverse: the login survives, the email stays registered, and the
-- person can never sign up again with that address.
--
-- Both deletion paths were removing only the profile:
--   * purge_scheduled_deletions()  the nightly job after the 30 day grace
--   * the admin panel              a direct delete on profiles
--
-- These functions are security definer, so they run as the database owner
-- and may touch the auth schema. That is why this needs no Edge Function
-- and no service-role key in the browser.
--
-- Safe to run more than once.
-- =============================================================

-- ── Nightly purge, corrected ──────────────────────────────────
create or replace function public.purge_scheduled_deletions()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.profiles
     where deletion_scheduled_at is not null
       and deletion_scheduled_at <= now()
  loop
    -- Deleting the login cascades to the profile and everything under it.
    delete from auth.users where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

revoke all on function public.purge_scheduled_deletions() from public;
grant execute on function public.purge_scheduled_deletions() to service_role;

-- ── Admin panel deletion ──────────────────────────────────────
create or replace function public.admin_delete_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;

  -- An admin removing their own account would lock the panel out.
  if p_user = auth.uid() then
    raise exception 'cannot delete your own account from the admin panel';
  end if;

  delete from auth.users where id = p_user;

  insert into public.admin_logs (admin_id, action, target_type, target_id)
  values (auth.uid(), 'delete_user', 'user', p_user);
end;
$fn$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ── Clean up logins whose profile was already deleted ─────────
-- Anything removed before this migration left an orphan behind. This
-- clears them, and is harmless once there are none.
create or replace function public.purge_orphaned_auth_users()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n integer;
begin
  delete from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id);
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.purge_orphaned_auth_users() from public;
grant execute on function public.purge_orphaned_auth_users() to authenticated;
