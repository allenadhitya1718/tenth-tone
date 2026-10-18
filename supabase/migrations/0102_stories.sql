-- ============================================================
-- 0102_stories.sql
-- Stories (Status): a photo or a short video that disappears after 24 hours.
--
-- Client notes 22, 25 and 31. Note 25 asks for Stories / Status where video is
-- allowed; note 22 asks for a song on a photo story; note 31 ("videos are
-- limited to Stories only") is read, as agreed earlier, as "Stories must
-- support video". The web app has no story code and no table for one, so this
-- file is the whole database side.
--
-- ── What this adds ──
--   stories               one row per story. Photo or video, an optional
--                         poster frame, an optional sound with a start
--                         offset (the photo-story song of note 22), an
--                         optional caption, and an audience.
--   story_views           who has seen which story, once per person.
--   media_delete_queue    URLs whose row has gone and whose bytes should be
--                         removed from R2. See "Media" below.
--   can_view_story()      the one visibility rule, used by the row policy.
--   fetch_story_tray()    the bar of avatars at the top of the home screen.
--   fetch_user_stories()  one person's current stories, with seen flags.
--   fetch_story_viewers() "seen by" for the owner of a story.
--   mark_story_viewed()   record a view.
--   purge_expired_stories()  nightly, via pg_cron (guarded, see the end).
--
-- ── Who sees a story ──
-- The owner always sees their own stories, expired ones included, until the
-- nightly purge (an expired story stays as the owner's archive for 7 days).
-- Anyone else sees a story only while it is unexpired, only when neither side
-- has blocked the other, only while the owner's account is not deactivated,
-- and only when the audience lets them in:
--   everyone       whoever may see the owner's posts (can_see_posts_of: on a
--                  private account that still means followers only)
--   followers      people who follow the owner (the default)
--   close_friends  people on the owner's close_friends list (0029:
--                  close_friends.user_id = owner, friend_id = viewer)
-- close_friends is readable only by its owner (0029's policy), which is why
-- the rule lives in a SECURITY DEFINER function rather than in the policy.
--
-- created_at and expires_at are set by the database on insert, whatever the
-- client sends, and cannot be changed afterwards: otherwise a "24-hour" story
-- could be inserted with an expiry ten years out and become a permanent post
-- outside every rule that governs posts.
--
-- ── Quota and rate limit ──
-- The upload quota is not row-based. It counts FILES, through the R2 ledger
-- (media_objects, 0062/0081) that the media-upload Edge Function writes when
-- it hands out a signed URL. Story media uploaded through media-upload is
-- therefore counted toward user_daily_uploads, user_daily_bytes and the
-- global ceiling with no change here, exactly like a video. Note that the
-- daily count (20 by default) is shared: a video story with a poster frame
-- spends two of the 20.
--
-- The row is guarded separately, for the reason 0056 gives for videos: the
-- quota guards the file, not the row, and a row with any URL can otherwise be
-- inserted in a loop. Limit: 50 stories per rolling 24 hours, same shape as
-- 0050/0056 (rate_limit_exceeded()). Well above what anyone posts by hand,
-- and in practice the upload quota binds first.
--
-- ── Media: what happens to the bytes ──
-- READ THIS. The hourly media-reconcile sweep (0064) does NOT reclaim story
-- media. It deletes only (1) uploads that never confirmed and (2) objects
-- with no ledger row at all; a 'stored' object is never deleted by it, even
-- when nothing references it any more. A deleted story's file is 'stored',
-- so the sweep leaves it in R2 (counted against the ceiling, and still
-- world-readable at its URL, which is the privacy problem 0081 describes).
--
-- So every story delete (by its owner, by an admin, by the nightly purge, or
-- by an account deletion cascading) queues the story's media_url and
-- poster_url in public.media_delete_queue. Nothing consumes that queue yet.
-- Two follow-ups, both in Edge Functions (not done here):
--   1. media-upload: add stories.media_url and stories.poster_url to
--      REFERENCED_BY. Without that, deleting a VIDEO whose file a story also
--      uses (sharing your own post to your story) would remove bytes a live
--      story is still serving. Do this before step 2 and before the app ships
--      stories.
--   2. media-reconcile (or a new job): for each queued URL, run media-upload's
--      existing reference check across REFERENCED_BY, delete the object and
--      mark its media_objects row 'deleted' (0081) when nothing references
--      it, then remove the queue row. Until then the queue only accumulates;
--      it is a list of work, not a deletion.
-- Meanwhile the app can delete a story's media immediately when the OWNER
-- deletes the story, by calling media-upload's delete action with the URL,
-- the same way it does for a deleted video (0081). Expired stories have no
-- such caller, which is what the queue is for.
--
-- media-upload accepts images only as JPEG (bucket 'videos': mp4, webm, mov,
-- jpg, jpeg). A photo story must be converted to JPEG before upload.
--
-- ── Applying it ──
-- Apply in the Supabase SQL editor AFTER 0001..0096. Safe to re-run. The
-- pg_cron block at the end sits outside the transaction, as in 0083, and does
-- nothing (with a notice) if pg_cron is not enabled; enable it from the
-- dashboard (Database -> Extensions) as 0051 records, then re-run this file.
-- Content screening (0066) happens in the app before the write, as for
-- videos; the app should screen story media and captions the same way.
-- ============================================================

begin;

-- ── 1. Stories ───────────────────────────────────────────

create table if not exists public.stories (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  media_url      text not null,
  media_kind     text not null,
  poster_url     text,
  sound_id       uuid references public.sounds (id) on delete set null,
  sound_start_ms integer not null default 0,
  caption        text,
  audience       text not null default 'followers',
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '24 hours'),

  constraint stories_media_kind_check
    check (media_kind in ('image', 'video')),
  constraint stories_media_url_check
    check (char_length(media_url) between 1 and 2048 and media_url ~* '^https?://'),
  constraint stories_poster_url_check
    check (poster_url is null
           or (char_length(poster_url) between 1 and 2048 and poster_url ~* '^https?://')),
  -- Ten minutes is far past any sound in the library; it only stops nonsense.
  constraint stories_sound_start_check
    check (sound_start_ms between 0 and 600000),
  constraint stories_caption_length
    check (caption is null or char_length(caption) <= 500),
  constraint stories_audience_check
    check (audience in ('everyone', 'followers', 'close_friends')),
  constraint stories_expiry_after_creation
    check (expires_at > created_at)
);

-- One person's stories, newest first: the viewer, the tray, the rate limit.
create index if not exists idx_stories_user_created
  on public.stories (user_id, created_at desc);

-- The tray's "unexpired" filter and the nightly purge.
create index if not exists idx_stories_expires
  on public.stories (expires_at);

alter table public.stories enable row level security;


-- ── 2. The visibility rule ───────────────────────────────
-- Expiry is checked in the policy, not here, so the owner's own-row policy
-- can keep showing them their expired stories.
create or replace function public.can_view_story(
  p_owner    uuid,
  p_audience text,
  p_viewer   uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select p_viewer is not null
     and p_owner is not null
     and (
       p_owner = p_viewer
       or (
         not public.is_blocked_between(p_owner, p_viewer)
         and not exists (select 1 from public.profiles
                          where id = p_owner and deactivated_at is not null)
         and case p_audience
               when 'everyone' then
                 public.can_see_posts_of(p_owner, p_viewer)
               when 'followers' then
                 exists (select 1 from public.follows
                          where follower_id = p_viewer and followed_id = p_owner)
               when 'close_friends' then
                 exists (select 1 from public.close_friends
                          where user_id = p_owner and friend_id = p_viewer)
               else false
             end
       )
     );
$fn$;

-- Signed-in only, and named roles, because `from public` alone is a no-op on
-- Supabase (0073).
revoke all on function public.can_view_story(uuid, text, uuid) from public, anon;
grant execute on function public.can_view_story(uuid, text, uuid) to authenticated;


-- ── 3. Row policies on stories ───────────────────────────

-- The owner: everything on their own rows. What may change on an update is
-- narrowed by the trigger in section 4.
drop policy if exists "stories owner all" on public.stories;
create policy "stories owner all" on public.stories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Everyone else: unexpired, and allowed by can_view_story().
drop policy if exists "stories read visible" on public.stories;
create policy "stories read visible" on public.stories
  for select to authenticated
  using (
    expires_at > now()
    and public.can_view_story(user_id, audience, (select auth.uid()))
  );

-- Moderation, matching what admins have on videos (0002).
drop policy if exists "stories admin read" on public.stories;
create policy "stories admin read" on public.stories
  for select to authenticated
  using (public.is_admin());

drop policy if exists "stories admin delete" on public.stories;
create policy "stories admin delete" on public.stories
  for delete to authenticated
  using (public.is_admin());

-- Supabase grants every privilege on a new table to anon and authenticated by
-- default; take them back and give only what the policies use.
revoke all on public.stories from anon, authenticated;
grant select, insert, update, delete on public.stories to authenticated;


-- ── 4. Server-owned timestamps, frozen fields, rate limit ──

-- The rate-limit count below is served by idx_stories_user_created.
create or replace function public.stories_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  -- 50 per rolling 24 hours (0050/0056 pattern).
  select count(*) into n from public.stories
   where user_id = new.user_id
     and created_at > now() - interval '24 hours';
  perform public.rate_limit_exceeded(n, 50, 'stories');

  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  return new;
end;
$fn$;

revoke all on function public.stories_before_insert() from public, anon, authenticated;

drop trigger if exists trg_stories_before_insert on public.stories;
create trigger trg_stories_before_insert
  before insert on public.stories
  for each row execute function public.stories_before_insert();

-- Caption, audience, sound and poster may be edited. Whose story it is, what
-- the media is, and when it was posted and expires may not.
create or replace function public.stories_before_update()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.id         := old.id;
  new.user_id    := old.user_id;
  new.media_url  := old.media_url;
  new.media_kind := old.media_kind;
  new.created_at := old.created_at;
  new.expires_at := old.expires_at;
  return new;
end;
$fn$;

revoke all on function public.stories_before_update() from public, anon, authenticated;

drop trigger if exists trg_stories_before_update on public.stories;
create trigger trg_stories_before_update
  before update on public.stories
  for each row execute function public.stories_before_update();


-- ── 5. Views ─────────────────────────────────────────────

create table if not exists public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

-- The primary key serves "has this person seen this story" and "who saw this
-- story". This one serves deleting / exporting a person's own view rows.
create index if not exists idx_story_views_viewer
  on public.story_views (viewer_id, viewed_at desc);

alter table public.story_views enable row level security;

-- A viewer records their own view of a story they can see right now. The
-- subquery runs under the viewer's own policies on stories, so it finds the
-- story only if "stories read visible" lets them see it. The owner viewing
-- their own story is not a view.
drop policy if exists "story_views insert own" on public.story_views;
create policy "story_views insert own" on public.story_views
  for insert to authenticated
  with check (
    viewer_id = (select auth.uid())
    and exists (
      select 1 from public.stories s
       where s.id = story_views.story_id
         and s.user_id <> (select auth.uid())
         and s.expires_at > now()
    )
  );

-- The story's owner reads every view of it; a viewer reads their own rows
-- (which is how the app knows what is unseen).
drop policy if exists "story_views read" on public.story_views;
create policy "story_views read" on public.story_views
  for select to authenticated
  using (
    viewer_id = (select auth.uid())
    or exists (select 1 from public.stories s
                where s.id = story_views.story_id
                  and s.user_id = (select auth.uid()))
  );

-- No update or delete for clients. Rows go with their story (cascade).
revoke all on public.story_views from anon, authenticated;
grant select, insert on public.story_views to authenticated;

-- The time of a view is the server's, not the phone's.
create or replace function public.story_views_before_insert()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.viewed_at := now();
  return new;
end;
$fn$;

revoke all on function public.story_views_before_insert() from public, anon, authenticated;

drop trigger if exists trg_story_views_before_insert on public.story_views;
create trigger trg_story_views_before_insert
  before insert on public.story_views
  for each row execute function public.story_views_before_insert();


-- ── 6. Media left behind by a deleted story ──────────────
-- See "Media" in the header. A list of URLs to reclaim, written only by the
-- trigger below and read only by the service role. Nothing consumes it yet.
create table if not exists public.media_delete_queue (
  id        bigint generated always as identity primary key,
  url       text not null unique,
  source    text not null,
  queued_at timestamptz not null default now()
);

alter table public.media_delete_queue enable row level security;
-- No policies: clients can neither read nor write. The service role bypasses
-- RLS.
revoke all on public.media_delete_queue from anon, authenticated;

create or replace function public.queue_story_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.media_delete_queue (url, source)
  select u, 'stories'
    from unnest(array[old.media_url, old.poster_url]) as u
   where u is not null
  on conflict (url) do nothing;
  return null;
end;
$fn$;

revoke all on function public.queue_story_media() from public, anon, authenticated;

drop trigger if exists trg_queue_story_media on public.stories;
create trigger trg_queue_story_media
  after delete on public.stories
  for each row execute function public.queue_story_media();


-- ── 7. RPCs for the app ──────────────────────────────────
-- All four are security INVOKER: they read under the caller's own policies,
-- so none of them can return a story, a view or a profile the caller could
-- not read directly. They exist to save round trips, not to grant access.

-- The tray: you first (if you have a live story), then people you follow
-- with a story you can see, unseen ones before seen ones, newest first.
create or replace function public.fetch_story_tray(p_limit integer default 100)
returns table (
  user_id           uuid,
  handle            text,
  name              text,
  avatar_url        text,
  verified          boolean,
  is_me             boolean,
  story_count       integer,
  latest_story_at   timestamptz,
  has_unseen        boolean,
  has_close_friends boolean
)
language sql
stable
set search_path = public
as $fn$
  with me as (
    select (select auth.uid()) as id
  ),
  visible as (
    select s.id, s.user_id, s.audience, s.created_at
      from public.stories s
      cross join me
     where s.expires_at > now()
       and (
         s.user_id = me.id
         or exists (select 1 from public.follows f
                     where f.follower_id = me.id and f.followed_id = s.user_id)
       )
  ),
  per_user as (
    select v.user_id,
           count(*)::integer as story_count,
           max(v.created_at) as latest_story_at,
           bool_or(
             v.user_id <> me.id
             and not exists (select 1 from public.story_views sv
                              where sv.story_id = v.id and sv.viewer_id = me.id)
           ) as has_unseen,
           bool_or(v.user_id <> me.id and v.audience = 'close_friends') as has_close_friends
      from visible v
      cross join me
     group by v.user_id
  )
  select pu.user_id, p.handle, p.name, p.avatar_url, p.verified,
         (pu.user_id = me.id) as is_me,
         pu.story_count, pu.latest_story_at, pu.has_unseen, pu.has_close_friends
    from per_user pu
    join public.profiles p on p.id = pu.user_id
    cross join me
   order by (pu.user_id = me.id) desc,
            pu.has_unseen desc,
            pu.latest_story_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$fn$;

revoke all on function public.fetch_story_tray(integer) from public, anon;
grant execute on function public.fetch_story_tray(integer) to authenticated;


-- One person's current stories, oldest first (the order they are played in).
-- seen is always true for your own. view_count is filled only for your own
-- stories; for anyone else's it is null.
create or replace function public.fetch_user_stories(p_user_id uuid)
returns table (
  id              uuid,
  user_id         uuid,
  media_url       text,
  media_kind      text,
  poster_url      text,
  sound_id        uuid,
  sound_title     text,
  sound_author    text,
  sound_audio_url text,
  sound_start_ms  integer,
  caption         text,
  audience        text,
  created_at      timestamptz,
  expires_at      timestamptz,
  seen            boolean,
  view_count      integer
)
language sql
stable
set search_path = public
as $fn$
  select s.id, s.user_id, s.media_url, s.media_kind, s.poster_url,
         s.sound_id, snd.title, snd.author_name, snd.audio_url, s.sound_start_ms,
         s.caption, s.audience, s.created_at, s.expires_at,
         (s.user_id = (select auth.uid())
          or exists (select 1 from public.story_views sv
                      where sv.story_id = s.id
                        and sv.viewer_id = (select auth.uid()))) as seen,
         case when s.user_id = (select auth.uid())
              then (select count(*)::integer from public.story_views sv
                     where sv.story_id = s.id)
         end as view_count
    from public.stories s
    left join public.sounds snd on snd.id = s.sound_id
   where s.user_id = p_user_id
     and s.expires_at > now()
   order by s.created_at asc;
$fn$;

revoke all on function public.fetch_user_stories(uuid) from public, anon;
grant execute on function public.fetch_user_stories(uuid) to authenticated;


-- "Seen by", for the story's owner. Returns nothing for anyone else (the
-- story_views policy only shows the owner other people's rows). People on
-- either side of a block are left out.
create or replace function public.fetch_story_viewers(
  p_story_id uuid,
  p_limit    integer default 200,
  p_offset   integer default 0
)
returns table (
  viewer_id  uuid,
  handle     text,
  name       text,
  avatar_url text,
  verified   boolean,
  viewed_at  timestamptz
)
language sql
stable
set search_path = public
as $fn$
  select sv.viewer_id, p.handle, p.name, p.avatar_url, p.verified, sv.viewed_at
    from public.story_views sv
    join public.stories s  on s.id = sv.story_id
    join public.profiles p on p.id = sv.viewer_id
   where sv.story_id = p_story_id
     and s.user_id = (select auth.uid())
     and not public.is_blocked_between(s.user_id, sv.viewer_id)
   order by sv.viewed_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

revoke all on function public.fetch_story_viewers(uuid, integer, integer) from public, anon;
grant execute on function public.fetch_story_viewers(uuid, integer, integer) to authenticated;


-- Record a view. Idempotent: a second call is a no-op. Returns true when a
-- view was recorded now, false when it already existed, the story is your
-- own, or you cannot see it.
create or replace function public.mark_story_viewed(p_story_id uuid)
returns boolean
language plpgsql
set search_path = public
as $fn$
declare v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.story_views (story_id, viewer_id)
  select s.id, auth.uid()
    from public.stories s
   where s.id = p_story_id
     and s.user_id <> auth.uid()
     and s.expires_at > now()
  on conflict (story_id, viewer_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$fn$;

revoke all on function public.mark_story_viewed(uuid) from public, anon;
grant execute on function public.mark_story_viewed(uuid) to authenticated;


-- ── 8. Nightly purge ─────────────────────────────────────
-- Stories expired more than 7 days ago. Their views go by cascade, and their
-- media URLs land in media_delete_queue through the delete trigger.
create or replace function public.purge_expired_stories()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  delete from public.stories
   where expires_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.purge_expired_stories() from public, anon, authenticated;
grant execute on function public.purge_expired_stories() to service_role;

commit;


-- ── Schedule the purge ───────────────────────────────────
-- Outside the transaction and guarded, as in 0051 / 0083. 03:50 daily, after
-- the jobs at 03:00, 03:30 and 03:45. Unscheduling first makes a re-run safe.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - function created, nothing scheduled. Enable it in the Supabase dashboard (Database -> Extensions) and run this file again.';
    return;
  end if;
  begin perform cron.unschedule('purge-expired-stories'); exception when others then null; end;
  perform cron.schedule('purge-expired-stories', '50 3 * * *',
                        'select public.purge_expired_stories()');
end $$;


-- ── Checks (run after applying) ──
-- select 'stories has RLS' as check,
--        case when (select relrowsecurity from pg_class where oid = 'public.stories'::regclass)
--             then 'OK' else 'RLS OFF' end as result
-- union all
-- select 'story_views has RLS',
--        case when (select relrowsecurity from pg_class where oid = 'public.story_views'::regclass)
--             then 'OK' else 'RLS OFF' end
-- union all
-- select 'media_delete_queue has RLS',
--        case when (select relrowsecurity from pg_class where oid = 'public.media_delete_queue'::regclass)
--             then 'OK' else 'RLS OFF' end
-- union all
-- select 'story rate limit trigger',
--        case when exists (select 1 from pg_trigger
--                           where tgname = 'trg_stories_before_insert' and not tgisinternal)
--             then 'OK' else 'MISSING' end;
--
-- And, only where pg_cron is enabled (cron.job does not exist otherwise):
-- select jobname, schedule from cron.job where jobname = 'purge-expired-stories';
