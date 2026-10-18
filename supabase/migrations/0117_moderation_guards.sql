-- 0117 - owners cannot undo moderation or fake their numbers; a live that
-- ended stays ended
--
-- Security review 2026-10, finding F06 (high). Apply after 0116. Safe to
-- re-run.
--
-- ============================================================
-- F06 - WHAT AN OWNER COULD REWRITE ON THEIR OWN ROWS
-- ============================================================
-- videos: "videos write own" (0001) is FOR ALL with only
--     using/with check (auth.uid() = user_id)
-- so an owner could PATCH their own video with
--     is_hidden = false, hidden_at = null      -> undo a moderation hide
--     likes_count / views_count / shares_count / comments_count / saves_count
--                                              -> any number, which the
--                                                 ranking in 0108 reads
-- and could INSERT a video with counters already high.
--
-- live_streams: "live update own" (0038) is the same shape, so a host could
--     status 'banned' -> 'live'                -> un-ban their own stream
--     status 'ended'  -> 'live' (repeatedly)   -> notify_on_live (0030) fires
--                                                 on every transition into
--                                                 'live', i.e. a push to every
--                                                 follower per PATCH
--     viewer_count / viewer_count_max          -> any number
-- and a second trigger, tr_notify_followers_live (0045), ALSO notified every
-- follower on insert, so each live already sent two notifications per
-- follower (one of them ignoring notif_live and mutes).
--
-- Fixes: two guard triggers. SECURITY INVOKER on purpose, so current_user is
-- the role that issued the statement: 'authenticated' is a request from the
-- app and is guarded; the counter triggers (bump_video_likes, bump_saves_count,
-- ...), join_live_stream / leave_live_stream, auto_hide_on_report,
-- close_stale_live_streams and service jobs all run as the owner inside
-- SECURITY DEFINER code and are untouched. Admins (is_admin(), the web admin
-- panel's direct updates) are untouched too. Same idea as
-- guard_profile_privileges (0048/0073): guarded columns are reset silently.
-- tr_notify_followers_live is dropped; notify_on_live (0030) stays, it is the
-- one that honours notif_live, mutes and blocks.

begin;

-- ── videos ──────────────────────────────────────────────────────────────
create or replace function public.guard_video_columns()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.likes_count    := 0;
    new.comments_count := 0;
    new.shares_count   := 0;
    new.views_count    := 0;
    new.saves_count    := 0;
    new.is_hidden      := false;
    new.hidden_at      := null;
    new.hidden_reason  := null;
  else
    new.user_id        := old.user_id;
    new.likes_count    := old.likes_count;
    new.comments_count := old.comments_count;
    new.shares_count   := old.shares_count;
    new.views_count    := old.views_count;
    new.saves_count    := old.saves_count;
    new.is_hidden      := old.is_hidden;
    new.hidden_at      := old.hidden_at;
    new.hidden_reason  := old.hidden_reason;
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_video_columns() from public, anon, authenticated;

drop trigger if exists tr_guard_video_columns on public.videos;
create trigger tr_guard_video_columns
  before insert or update on public.videos
  for each row execute function public.guard_video_columns();

-- ── live_streams ────────────────────────────────────────────────────────
create or replace function public.guard_live_stream()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status           := 'live';
    new.viewer_count     := 0;
    new.viewer_count_max := 0;
    new.ended_at         := null;
    return new;
  end if;

  new.host_id          := old.host_id;
  new.viewer_count     := old.viewer_count;
  new.viewer_count_max := old.viewer_count_max;

  -- The only status change a host makes is ending a live stream. Anything
  -- else (un-ban, re-open an ended stream) is ignored.
  if new.status is distinct from old.status
     and not (old.status = 'live' and new.status = 'ended') then
    new.status   := old.status;
    new.ended_at := old.ended_at;
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_live_stream() from public, anon, authenticated;

drop trigger if exists tr_guard_live_stream on public.live_streams;
create trigger tr_guard_live_stream
  before insert or update on public.live_streams
  for each row execute function public.guard_live_stream();

-- One notification per follower per live, from notify_on_live (0030).
drop trigger if exists tr_notify_followers_live on public.live_streams;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'videos guarded' as check,
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.videos'::regclass and tgname = 'tr_guard_video_columns'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end as result
union all
select 'live_streams guarded',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.live_streams'::regclass and tgname = 'tr_guard_live_stream'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'single live notification trigger',
       case when not exists (select 1 from pg_trigger
                              where tgrelid = 'public.live_streams'::regclass
                                and tgname = 'tr_notify_followers_live')
             and exists (select 1 from pg_trigger
                          where tgrelid = 'public.live_streams'::regclass
                            and tgname = 'trg_notify_on_live')
            then 'OK' else 'CHECK' end
union all
select 'counter triggers still SECURITY DEFINER (or the guard would undo them)',
       case when not exists (select 1 from pg_proc
                              where proname in ('bump_video_likes', 'bump_video_comments', 'bump_saves_count',
                                                'join_live_stream', 'leave_live_stream', 'auto_hide_on_report',
                                                'close_stale_live_streams')
                                and not prosecdef)
            then 'OK' else 'A COUNTER WRITER IS SECURITY INVOKER' end
order by 1;

-- Behavioural test, as the owner of a hidden video V and an ended live L:
--   update videos set is_hidden = false, likes_count = 99999 where id = V returning is_hidden, likes_count;
--     -- unchanged
--   update live_streams set status = 'live' where id = L returning status;
--     -- still 'ended', and no notification rows appear
