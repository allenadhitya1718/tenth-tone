-- ============================================================
-- 0011_completion_diversity.sql
-- Two cheap, high-value ranking improvements that work from day
-- one even with zero/low traffic (unlike ML ranking or
-- collaborative filtering, which need real usage data to be
-- worth the complexity):
--   1. Completion rate — % of a video actually watched is a much
--      stronger signal than raw watch_ms (a 10s video watched
--      fully beats a 60s video watched for 8s).
--   2. Anti-repeat diversity — cap how many videos from the same
--      creator can appear in one feed fetch, so a single active
--      creator can't dominate the page.
-- ============================================================

-- ── 1. Completion rate ──
alter table public.video_engagement
  add column if not exists max_completion_pct numeric(4,3) not null default 0; -- 0.000–1.000

create or replace function public.track_engagement(
  p_video_id        uuid,
  p_watch_ms        integer default 0,
  p_loop_count      integer default 0,
  p_completion_pct  numeric default 0
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

  insert into public.video_engagement (user_id, video_id, watch_count, total_watch_ms, max_completion_pct, last_watched_at)
  values (v_user, p_video_id, greatest(p_loop_count, 0) + 1, greatest(p_watch_ms, 0), least(greatest(p_completion_pct, 0), 1), now())
  on conflict (user_id, video_id) do update set
    watch_count         = public.video_engagement.watch_count + greatest(p_loop_count, 0) + 1,
    total_watch_ms       = public.video_engagement.total_watch_ms + greatest(p_watch_ms, 0),
    max_completion_pct   = greatest(public.video_engagement.max_completion_pct, least(greatest(p_completion_pct, 0), 1)),
    last_watched_at       = now();
end;
$$;

grant execute on function public.track_engagement(uuid, integer, integer, numeric) to authenticated;

-- ── 2. fetch_fyp_feed: completion signal + anti-repeat diversity cap ──
drop function if exists public.fetch_fyp_feed(integer, integer, uuid);

create or replace function public.fetch_fyp_feed(
  p_limit            integer default 20,
  p_offset           integer default 0,
  p_user_id          uuid    default null,
  p_max_per_creator  integer default 3
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
    -- Creators/sounds this user watched twice+, spent real time on,
    -- or watched to (near) completion at least once
    select v2.user_id as pref_creator, v2.sound_id as pref_sound
    from public.video_engagement e
    join public.videos v2 on v2.id = e.video_id
    where p_user_id is not null
      and e.user_id = p_user_id
      and (e.watch_count >= 2 or e.total_watch_ms >= 8000 or e.max_completion_pct >= 0.8)
  ),
  liked_prefs as (
    select v2.user_id as pref_creator, v2.sound_id as pref_sound
    from public.likes l
    join public.videos v2 on v2.id = l.video_id
    where p_user_id is not null and l.user_id = p_user_id
  ),
  blocked as (
    select blocked_id from public.blocks
    where p_user_id is not null and blocker_id = p_user_id
  ),
  scored as (
    select
      v.id, v.user_id, v.description, v.music, v.sound_id, v.video_url, v.thumbnail, v.privacy,
      v.likes_count, v.comments_count, v.shares_count, v.views_count, v.created_at,
      p.name as user_name, p.handle as user_handle, p.avatar_url as user_avatar_url, p.verified as user_verified,
      (
        (v.likes_count * 3) +
        (v.comments_count * 5) +
        (v.shares_count * 7) +
        (v.views_count * 1) +
        case
          when v.created_at >= now() - interval '24 hours' then 1000
          when v.created_at >= now() - interval '72 hours' then 500
          else 0
        end +
        case when exists (select 1 from prefs where pref_creator = v.user_id) then 2000 else 0 end +
        case when v.sound_id is not null and exists (select 1 from prefs where pref_sound = v.sound_id) then 800 else 0 end +
        case when exists (select 1 from liked_prefs where pref_creator = v.user_id) then 1500 else 0 end
      ) as score
    from public.videos v
    join public.profiles p on p.id = v.user_id
    where v.is_draft = false
      and v.privacy = 'public'
      and (p.banned_until is null or p.banned_until <= now())
      and v.user_id not in (select blocked_id from blocked)
  ),
  ranked as (
    select *,
      row_number() over (partition by user_id order by score desc, created_at desc) as creator_rank
    from scored
  )
  select id, user_id, description, music, sound_id, video_url, thumbnail, privacy,
         likes_count, comments_count, shares_count, views_count, created_at,
         user_name, user_handle, user_avatar_url, user_verified
  from ranked
  where creator_rank <= greatest(p_max_per_creator, 1)
  order by score desc, created_at desc
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.fetch_fyp_feed(integer, integer, uuid, integer) to authenticated, anon;
