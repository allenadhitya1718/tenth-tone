-- 0073 — four things that were never actually true
--
-- Run this whole file once in the Supabase SQL editor. Safe to re-run.
--
-- ============================================================
-- 1. EVERY `revoke ... from public` IN THIS SCHEMA WAS A NO-OP
-- ============================================================
-- Proved against the live database using nothing but the anon key that ships
-- inside the APK, with no user signed in:
--
--   POST /rest/v1/rpc/purge_stale_locations  ->  200, deleted-count returned
--   POST /rest/v1/rpc/storage_used_bytes     ->  200, 213838020
--
-- A Supabase project ships with
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- so every `create function` hands EXECUTE to anon and authenticated
-- EXPLICITLY. `revoke all on function ... from public` removes only the PUBLIC
-- grant, which was never the operative one. The statement reads correct, raises
-- nothing, and changes nothing.
--
-- The exposure: purge_scheduled_deletions() deletes auth.users rows,
-- purge_orphaned_auth_users() bulk-deletes accounts, purge_stale_locations()
-- deletes coordinates, and setting_text()/setting_bool() read any user's
-- private settings - the same read that RLS correctly refuses on the table
-- itself. All callable by anyone who extracts a key from the app bundle.
--
-- Roles must be named. `from public` is not enough, and never was.

do $$
declare f record;
begin
  -- Service-role only: destructive or operational.
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'purge_stale_locations', 'purge_scheduled_deletions',
         'purge_orphaned_auth_users', 'expire_pending_media',
         'claim_storage_alert_email', 'send_storage_alert_email',
         'ai_flag_video', 'moderation_log_event', 'call_job_endpoint',
         'close_stale_live_streams', 'self_delete_account'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;

  -- Signed-in only: helpers that read or decide on someone's private state.
  -- An anonymous visitor has no business asking any of these.
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'setting_bool', 'setting_text', 'is_blocked_between', 'is_chat_member',
         'is_chat_creator', 'may_message_in_chat', 'may_message', 'may_comment_on',
         'list_blocked', 'chat_unread_counts', 'chat_request_flags',
         'storage_used_bytes', 'upload_quota_status', 'user_uploads_today'
       )
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- has_blocked() is the exception and must KEEP anon: 0070's profiles policy
-- calls it for signed-out visitors too, and a policy that cannot call its own
-- helper fails closed for everyone browsing logged out.
grant execute on function public.has_blocked(uuid, uuid) to authenticated, anon;

-- Stop the next function inheriting the same grant.
alter default privileges in schema public revoke execute on functions from anon;


-- ============================================================
-- 2. NO ACCOUNT HAS EVER ACTUALLY BEEN DELETED
-- ============================================================
-- Four foreign keys reference profiles(id) with no ON DELETE clause, so they
-- default to NO ACTION. `delete from auth.users` cascades to profiles, that
-- delete raises foreign_key_violation, and because the purge loop runs in one
-- transaction with no handler, ONE un-deletable profile rolls back the entire
-- night's batch. Nobody is ever deleted.
--
-- chats.created_by is the decisive one: db.js sets it on every DM and every
-- group, so anyone who has ever opened a conversation is permanently
-- un-deletable. That is every real user.
--
-- set null, not cascade: deleting a person must not delete the conversations
-- other people are still in, or the moderation record of what they did.

alter table public.chats      drop constraint if exists chats_created_by_fkey;
alter table public.chats      add  constraint chats_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.reports    drop constraint if exists reports_resolved_by_fkey;
alter table public.reports    add  constraint reports_resolved_by_fkey
  foreign key (resolved_by) references public.profiles (id) on delete set null;

alter table public.admin_logs drop constraint if exists admin_logs_admin_id_fkey;
alter table public.admin_logs add  constraint admin_logs_admin_id_fkey
  foreign key (admin_id) references public.profiles (id) on delete set null;

alter table public.ads        drop constraint if exists ads_created_by_fkey;
alter table public.ads        add  constraint ads_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

-- And one bad row must not take the batch with it.
create or replace function public.purge_scheduled_deletions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; n integer := 0;
begin
  for r in
    select id from public.profiles
     where deletion_scheduled_at is not null
       and deletion_scheduled_at <= now()
  loop
    -- Per row, so a profile that still cannot be removed is logged and
    -- skipped rather than rolling back everyone else's deletion.
    begin
      delete from auth.users where id = r.id;
      n := n + 1;
    exception when others then
      raise warning 'purge_scheduled_deletions: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke all on function public.purge_scheduled_deletions() from public, anon, authenticated;
grant execute on function public.purge_scheduled_deletions() to service_role;


-- ============================================================
-- 3. "DEACTIVATE MY ACCOUNT" DID NOTHING
-- ============================================================
-- guard_profile_privileges() reverts deactivated_at whenever auth.uid() is not
-- null and the caller is not an admin. security definer changes the ROLE, not
-- auth.uid() - that comes from the JWT claim and survives into the function
-- body. So inside deactivate_account() the guard treated the user as untrusted
-- and silently discarded the write.
--
-- The user was told their profile, videos and comments were hidden from
-- everyone, and was signed out. Nothing was hidden. And because
-- deletion_scheduled_at was NOT in the guarded list, the deletion timer stuck
-- while the hiding did not - so an account awaiting deletion stayed fully
-- public for the whole 30-day grace period, exactly the opposite of what
-- delete-account.html promises.
--
-- Fixed by letting a person change their OWN account status, rather than by
-- threading a trusted flag through three RPCs - fewer moving parts, and it
-- states the actual rule: the guard is about privilege, not about leaving.

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trusted boolean := (auth.uid() is null) or public.is_admin();
begin
  if not v_trusted then
    -- These three are privilege. Nobody may grant them to themselves.
    new.is_admin     := old.is_admin;
    new.verified     := old.verified;
    new.banned_until := old.banned_until;

    -- These two are NOT privilege - they are a person leaving. Guarding them
    -- against the account's own owner is what broke deactivation: the guard
    -- exists to stop someone making themselves an admin, not to stop them
    -- closing their own account.
    --
    -- Still guarded against everyone ELSE, which is the real risk: without
    -- this, one user could deactivate another, or schedule their deletion.
    if new.id is distinct from auth.uid() then
      new.deactivated_at        := old.deactivated_at;
      new.deletion_scheduled_at := old.deletion_scheduled_at;   -- was unguarded
    end if;
  end if;
  if not v_trusted and pg_trigger_depth() <= 1 then
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.likes_count     := old.likes_count;
  end if;
  return new;
end;
$$;


-- ============================================================
-- 4. DRAFTS WERE READABLE BY ANYONE
-- ============================================================
-- Concealment was entirely client-side: every list query filters
-- is_draft = false, but the RLS policy has no is_draft term, a draft carries
-- the default privacy 'public', and /v/<id> is a public route. So an
-- unpublished draft opened normally for any visitor, signed out included.

drop policy if exists "videos read public" on public.videos;
create policy "videos read public" on public.videos
  for select to authenticated, anon
  using (
    user_id = auth.uid()
    or (
      privacy = 'public'
      and coalesce(is_draft, false) = false
      and coalesce(is_hidden, false) = false
      and coalesce(is_archived, false) = false
      and public.can_see_posts_of(user_id, auth.uid())
    )
  );


-- ============================================================
-- VERIFY — every row should read OK
-- ============================================================
select 'anon can no longer execute purge functions' as check,
       case when not exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join lateral aclexplode(p.proacl) a
           join pg_roles r on r.oid = a.grantee
          where n.nspname = 'public' and r.rolname = 'anon'
            and p.proname like 'purge%'
       ) then 'OK' else 'STILL EXPOSED' end as result
union all
select 'anon can no longer read anyone''s settings',
       case when not exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join lateral aclexplode(p.proacl) a
           join pg_roles r on r.oid = a.grantee
          where n.nspname = 'public' and r.rolname = 'anon'
            and p.proname in ('setting_text','setting_bool')
       ) then 'OK' else 'STILL EXPOSED' end
union all
select 'has_blocked still callable by anon (0070 needs it)',
       case when exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join lateral aclexplode(p.proacl) a
           join pg_roles r on r.oid = a.grantee
          where n.nspname = 'public' and r.rolname = 'anon' and p.proname = 'has_blocked'
       ) then 'OK' else 'BROKEN — signed-out browsing will fail' end
union all
select 'no blocking FKs left on profiles',
       case when not exists (
         select 1 from pg_constraint
          where confrelid = 'public.profiles'::regclass and confdeltype = 'a'
       ) then 'OK' else 'STILL PRESENT — deletions will keep aborting' end
union all
select 'deletion timer is now guarded',
       case when pg_get_functiondef('public.guard_profile_privileges()'::regprocedure)
                 like '%deletion_scheduled_at := old.deletion_scheduled_at%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'drafts are no longer publicly readable',
       case when pg_get_expr(polqual, polrelid) like '%is_draft%'
            then 'OK' else 'NOT UPDATED' end
  from pg_policy
 where polrelid = 'public.videos'::regclass and polname = 'videos read public'
order by 1;
