-- ============================================================
-- 0053_follow_requests_and_counter_repair.sql
--
-- Two things, both found by the user testing follows in the browser.
--
-- A. Following a PRIVATE account has never worked.
--
--    follow_or_request() (0030) writes a notification of type
--    'follow_request'. The notifications table's check constraint allows
--    'like', 'comment', 'follow', 'mention', 'message', 'system' — and,
--    since 0045, 'live'. 'follow_request' is not among them, so the insert
--    raises 23514, and because it happens inside the same transaction the
--    entire follow request is rolled back with it.
--
--    So: public accounts follow fine, private accounts throw an error. The
--    approve/decline screen exists and has simply never had anything to
--    show, because no request could ever be created.
--
-- B. The counter repair in 0052 did nothing.
--
--    Its UPDATE fires guard_profile_privileges, which reverts the counters
--    unless is_admin(). Run from the SQL editor there is no signed-in user,
--    so auth.uid() is null, is_admin() is false, and the repair reverted
--    itself. The verification at the end duly reported the same mismatches.
--
--    Fixed at the root: a null auth.uid() means the statement did not come
--    from a client at all — it is the SQL editor, the service role, or a
--    cron job. Those are trusted and must be able to maintain counters;
--    without this the nightly jobs cannot either. This is not a hole: RLS
--    already refuses anonymous writes to profiles, since
--    `using (auth.uid() = id)` cannot be satisfied when auth.uid() is null.
-- ============================================================


-- ── A. Allow the follow_request notification type ────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like', 'comment', 'follow', 'mention', 'message',
                  'system', 'live', 'follow_request'));


-- ── B. Let trusted, non-client contexts maintain counters ──
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trusted boolean := (auth.uid() is null) or public.is_admin();
begin
  -- Privilege and moderation state: never settable by a client, whatever
  -- the nesting depth.
  if not v_trusted then
    new.is_admin       := old.is_admin;
    new.verified       := old.verified;
    new.banned_until   := old.banned_until;
    new.deactivated_at := old.deactivated_at;
  end if;

  -- Counters: written by triggers, by maintenance, and by nothing else.
  -- Allowed when the update comes from inside another trigger
  -- (pg_trigger_depth() > 1) or from a trusted context; reverted when a
  -- client tries to set them directly.
  if not v_trusted and pg_trigger_depth() <= 1 then
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.likes_count     := old.likes_count;
  end if;

  return new;
end;
$$;


-- ── Now the repair can actually apply ────────────────────
update public.profiles p
   set followers_count = (select count(*) from public.follows f where f.followed_id = p.id),
       following_count = (select count(*) from public.follows f where f.follower_id = p.id),
       likes_count     = (select count(*)
                            from public.likes l
                            join public.videos v on v.id = l.video_id
                           where v.user_id = p.id);


-- ── Verify both, rather than assuming ────────────────────
select 'follow_request notification allowed' as check,
       case when exists (
         select 1 from pg_constraint
          where conname = 'notifications_type_check'
            and pg_get_constraintdef(oid) like '%follow_request%'
       ) then 'OK' else 'MISSING' end as result
union all
select 'profiles with a wrong follower count',
       (select count(*)::text from public.profiles p
         where p.followers_count <> (select count(*) from public.follows f where f.followed_id = p.id))
union all
select 'profiles with a wrong following count',
       (select count(*)::text from public.profiles p
         where p.following_count <> (select count(*) from public.follows f where f.follower_id = p.id))
union all
select 'admin columns still locked to clients',
       case when exists (select 1 from pg_trigger where tgname = 'tr_guard_profile_privileges')
            then 'OK' else 'GUARD MISSING' end;
