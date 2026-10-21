-- 0155 - Add a feed video to your story (owner request)
--
-- Like Instagram's "Add to story": the share sheet posts a story that plays
-- someone's video with a card naming its creator; tapping the card opens the
-- original post. The video stays the creator's: nothing is copied, its views
-- and likes stay on the post.
--
--   stories.shared_video_id   the video the story shows (null = an ordinary
--                             story). Deleting the video deletes the story.
--
-- Rules, enforced here rather than trusted from the app:
--   * Only a video you could share publicly: a published, public, visible
--     post on a PUBLIC account (or your own post). A private account's post
--     would otherwise reach people who do not follow it. Never across a
--     block.
--   * The story's media is the video's own file and cover, filled in by the
--     database from the videos row (the app cannot point a "share" at some
--     other file), with no added sound. Frozen afterwards.
--   * Seeing the story also needs seeing the video, checked at read time
--     under the viewer's own rules on videos: if the creator later goes
--     private, hides or archives the post, or blocks you, the story stops
--     showing.
--   * Deleting the story never queues the video's files for removal (they
--     are the creator's, not the story's).
--
-- fetch_user_stories is re-created (a returned column cannot be added in
-- place) with the shared video's id and creator; same security and filters
-- as 0151.
--
-- Needs 0102, 0110, 0122, 0140, 0151. Safe to re-run.

begin;

alter table public.stories
  add column if not exists shared_video_id uuid references public.videos (id) on delete cascade;
create index if not exists idx_stories_shared_video
  on public.stories (shared_video_id) where shared_video_id is not null;

-- ── 1. Fill in and freeze a shared video's story ────────────────────────
create or replace function public.stories_share_video()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.videos%rowtype;
  v_private boolean;
  v_gone boolean;
begin
  if tg_op = 'UPDATE' then
    new.shared_video_id := old.shared_video_id;
    if old.shared_video_id is not null then
      new.poster_url := old.poster_url;
      new.sound_id := null;
      new.sound_start_ms := 0;
    end if;
    return new;
  end if;

  if new.shared_video_id is null then
    return new;
  end if;

  select * into v from public.videos where id = new.shared_video_id;
  if not found then
    raise exception 'video_not_shareable' using errcode = '22023';
  end if;
  select coalesce(p.is_private, false), p.deactivated_at is not null
    into v_private, v_gone
    from public.profiles p where p.id = v.user_id;

  if coalesce(v.video_url, '') !~* '^https?://'
     or (v.user_id <> new.user_id and (
          v.privacy <> 'public'
          or coalesce(v.is_draft, false)
          or coalesce(v.is_hidden, false)
          or coalesce(v.is_archived, false)
          or coalesce(v_private, true)
          or coalesce(v_gone, true)
          or public.is_blocked_between(v.user_id, new.user_id)))
  then
    raise exception 'video_not_shareable' using errcode = '22023';
  end if;

  new.media_url := v.video_url;
  new.media_kind := 'video';
  new.poster_url := case when coalesce(v.thumbnail, '') ~* '^https?://' and char_length(v.thumbnail) <= 2048
                         then v.thumbnail end;
  new.sound_id := null;
  new.sound_start_ms := 0;
  return new;
end;
$fn$;
revoke all on function public.stories_share_video() from public, anon, authenticated;

drop trigger if exists trg_stories_share_video on public.stories;
create trigger trg_stories_share_video
  before insert or update on public.stories
  for each row execute function public.stories_share_video();

-- ── 2. Seeing a shared story needs seeing the video ─────────────────────
-- 0140's policy plus the last clause. The EXISTS runs under the viewer's own
-- policies on videos ("videos read public").
drop policy if exists "stories read visible" on public.stories;
create policy "stories read visible" on public.stories
  for select to authenticated using (
    expires_at > now()
    and is_hidden = false
    and public.can_view_story(user_id, audience, (select auth.uid()))
    and (shared_video_id is null
         or exists (select 1 from public.videos v where v.id = stories.shared_video_id))
  );

-- ── 3. A shared story's files are the creator's ─────────────────────────
-- 0110's function, returning early for a shared video.
create or replace function public.queue_story_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.shared_video_id is not null then
    return null;
  end if;
  insert into public.media_delete_queue as q (url, source)
  -- distinct: a story whose poster IS its media would otherwise propose the
  -- same row twice, which ON CONFLICT DO UPDATE refuses.
  select distinct u, 'stories'
    from unnest(array[old.media_url, old.poster_url]) as u
   where u is not null
  on conflict (url) do update
     set status          = 'queued',
         attempts        = 0,
         next_attempt_at = now(),
         claimed_at      = null,
         last_error      = null,
         outcome         = null,
         done_at         = null,
         queued_at       = now()
   where q.status in ('done', 'kept', 'skipped', 'failed');
  return null;
end;
$fn$;
revoke all on function public.queue_story_media() from public, anon, authenticated;

-- ── 4. fetch_user_stories: 0151's plus the shared video ─────────────────
-- The video and its creator are read under the caller's own policies, so
-- they come back null when the caller cannot see them (the app then shows
-- "Video unavailable" on its own story).
drop function if exists public.fetch_user_stories(uuid);
create function public.fetch_user_stories(p_user_id uuid)
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
  view_count      integer,
  liked           boolean,
  shared_video_id uuid,
  shared_visible  boolean,
  shared_handle   text,
  shared_name     text,
  shared_avatar   text
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
         end as view_count,
         exists (select 1 from public.story_views sv
                  where sv.story_id = s.id
                    and sv.viewer_id = (select auth.uid())
                    and sv.liked_at is not null) as liked,
         s.shared_video_id,
         (v.id is not null) as shared_visible,
         cp.handle, cp.name, cp.avatar_url
    from public.stories s
    left join public.sounds snd on snd.id = s.sound_id
    left join public.videos v on v.id = s.shared_video_id
    left join public.profiles cp on cp.id = v.user_id
   where s.user_id = p_user_id
     and s.expires_at > now()
   order by s.created_at asc;
$fn$;
revoke all on function public.fetch_user_stories(uuid) from public, anon;
grant execute on function public.fetch_user_stories(uuid) to authenticated;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'stories.shared_video_id exists' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'stories'
                            and column_name = 'shared_video_id')
            then 'OK' else 'MISSING' end as result
union all
select 'a share is filled in by the database',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.stories'::regclass
                            and tgname = 'trg_stories_share_video' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'seeing a share needs seeing the video',
       case when exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'stories'
                            and policyname = 'stories read visible'
                            and qual like '%shared_video_id%')
            then 'OK' else 'NOT UPDATED' end
union all
select 'deleting a share keeps the creator''s files',
       case when pg_get_functiondef('public.queue_story_media()'::regprocedure) like '%shared_video_id is not null%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'fetch_user_stories returns the shared video',
       case when exists (select 1 from pg_proc
                          where pronamespace = 'public'::regnamespace and proname = 'fetch_user_stories'
                            and 'shared_video_id' = any(proargnames))
            then 'OK' else 'MISSING' end
order by 1;
