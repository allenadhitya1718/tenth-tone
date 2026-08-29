-- ============================================================
-- 0010_engagement_feed.sql
-- Personalized "For You" feed via engagement scoring:
--   1. video_engagement table — tracks per-user watch time / replay
--      count per video (rewatching or liking = "the algorithm likes
--      this user likes this kind of content, show more of it")
--   2. track_engagement() RPC — client calls this as a user watches
--   3. fetch_fyp_feed() rewritten to accept p_user_id and boost
--      videos from creators/sounds the user has shown engagement
--      with, plus excludes content from blocked users
-- ============================================================

-- ── 1. Engagement tracking table ──
create table if not exists public.video_engagement (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  video_id        uuid not null references public.videos   (id) on delete cascade,
  watch_count     integer not null default 0,   -- number of watch sessions / replays
  total_watch_ms  bigint  not null default 0,   -- cumulative watch time
  last_watched_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists idx_video_engagement_user on public.video_engagement (user_id);

alter table public.video_engagement enable row level security;
drop policy if exists "engagement own read" on public.video_engagement;
create policy "engagement own read" on public.video_engagement
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "engagement own write" on public.video_engagement;
create policy "engagement own write" on public.video_engagement
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 2. track_engagement RPC ──
-- Called by the client as a video is watched (on scroll-away or loop).
-- p_loop_count: how many times the video restarted (replayed) during this
-- watch session — replaying a clip is a strong positive signal.
create or replace function public.track_engagement(
  p_video_id   uuid,
  p_watch_ms   integer default 0,
  p_loop_count integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_video_id is null then
    return;
  end if;

  insert into public.video_engagement (user_id, video_id, watch_count, total_watch_ms, last_watched_at)
  values (v_user, p_video_id, greatest(p_loop_count, 0) + 1, greatest(p_watch_ms, 0), now())
  on conflict (user_id, video_id) do update set
    watch_count     = public.video_engagement.watch_count + greatest(p_loop_count, 0) + 1,
    total_watch_ms  = public.video_engagement.total_watch_ms + greatest(p_watch_ms, 0),
    last_watched_at = now();
end;
$$;

grant execute on function public.track_engagement(uuid, integer, integer) to authenticated;

-- ── 3. Personalized fetch_fyp_feed ──
-- Drop the old 2-arg signature so the new 3-arg (with default) version
-- doesn't create an ambiguous overload.
drop function if exists public.fetch_fyp_feed(integer, integer);

create or replace function public.fetch_fyp_feed(
  p_limit   integer default 20,
  p_offset  integer default 0,
  p_user_id uuid    default null
)
returns table (
  id uuid,
  user_id uuid,
  description text,
  music text,
  sound_id uuid,
  video_url text,
  thumbnail text,
  privacy text,
  likes_count integer,
  comments_count integer,
  shares_count integer,
  views_count integer,
  created_at timestamptz,
  user_name text,
  user_handle text,
  user_avatar_url text,
  user_verified boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with prefs as (
    -- Creators/sounds this user has watched twice+ or spent real time on
    select v2.user_id as pref_creator, v2.sound_id as pref_sound
    from public.video_engagement e
    join public.videos v2 on v2.id = e.video_id
    where p_user_id is not null
      and e.user_id = p_user_id
      and (e.watch_count >= 2 or e.total_watch_ms >= 8000)
  ),
  liked_prefs as (
    -- Creators/sounds this user has liked
    select v2.user_id as pref_creator, v2.sound_id as pref_sound
    from public.likes l
    join public.videos v2 on v2.id = l.video_id
    where p_user_id is not null and l.user_id = p_user_id
  ),
  blocked as (
    select blocked_id from public.blocks
    where p_user_id is not null and blocker_id = p_user_id
  )
  select
    v.id,
    v.user_id,
    v.description,
    v.music,
    v.sound_id,
    v.video_url,
    v.thumbnail,
    v.privacy,
    v.likes_count,
    v.comments_count,
    v.shares_count,
    v.views_count,
    v.created_at,
    p.name as user_name,
    p.handle as user_handle,
    p.avatar_url as user_avatar_url,
    p.verified as user_verified
  from public.videos v
  join public.profiles p on p.id = v.user_id
  where v.is_draft = false
    and v.privacy = 'public'
    and (p.banned_until is null or p.banned_until <= now())
    and v.user_id not in (select blocked_id from blocked)
  order by (
    -- Base popularity
    (v.likes_count * 3) +
    (v.comments_count * 5) +
    (v.shares_count * 7) +
    (v.views_count * 1) +
    -- Recency boost
    case
      when v.created_at >= now() - interval '24 hours' then 1000
      when v.created_at >= now() - interval '72 hours' then 500
      else 0
    end +
    -- Personalization: same creator as one the user rewatched/spent time on
    case when exists (select 1 from prefs where pref_creator = v.user_id) then 2000 else 0 end +
    -- Personalization: same sound as one the user rewatched/spent time on
    case when v.sound_id is not null and exists (select 1 from prefs where pref_sound = v.sound_id) then 800 else 0 end +
    -- Personalization: same creator as one the user liked
    case when exists (select 1 from liked_prefs where pref_creator = v.user_id) then 1500 else 0 end
  ) desc, v.created_at desc
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.fetch_fyp_feed(integer, integer, uuid) to authenticated, anon;
