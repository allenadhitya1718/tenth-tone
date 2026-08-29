-- ============================================================
-- RECOUNT_STATS.sql
--
-- The seed data shipped with this project wrote fabricated counters
-- straight into the tables (e.g. likes_count = 4700 on a video with
-- zero rows in `likes`). The app reads those columns, and the feed
-- algorithm ranks by them, so seeded posts permanently outranked
-- genuine ones.
--
-- This recomputes every counter from the actual rows. The demo videos
-- stay; only their numbers become truthful.
--
-- Safe to re-run at any time — it's a pure recalculation.
-- Run in: Supabase Dashboard → SQL Editor.
-- ============================================================

-- ── Videos: likes / comments / saves ──
update public.videos v set
  likes_count    = coalesce((select count(*) from public.likes    l where l.video_id = v.id), 0),
  comments_count = coalesce((select count(*) from public.comments c where c.video_id = v.id and c.is_hidden = false), 0),
  saves_count    = coalesce((select count(*) from public.saves    s where s.video_id = v.id), 0);

-- ── Videos: views ──
-- There is no views table; watch sessions are recorded in video_engagement
-- (added in this project's engagement migration), so unique viewers is the
-- only honest number available. Videos nobody has watched go to 0.
update public.videos v set
  views_count = coalesce((select count(*) from public.video_engagement e where e.video_id = v.id), 0);

-- ── Videos: shares ──
-- Shares are only counted from the moment the share button started
-- recording them, so there is no history to rebuild from. Reset to 0
-- rather than keep an invented figure.
update public.videos set shares_count = 0;

-- ── Profiles: followers / following ──
update public.profiles p set
  followers_count = coalesce((select count(*) from public.follows f where f.followed_id = p.id), 0),
  following_count = coalesce((select count(*) from public.follows f where f.follower_id = p.id), 0);

-- ── Profiles: total likes received across all of the user's videos ──
update public.profiles p set
  likes_count = coalesce((select sum(v.likes_count) from public.videos v where v.user_id = p.id), 0);

-- ── Sounds: how many videos actually use each sound ──
update public.sounds s set
  usage_count = coalesce((select count(*) from public.videos v where v.sound_id = s.id), 0);

-- ── Hashtags: rebuild from the descriptions that exist right now ──
delete from public.hashtags;
insert into public.hashtags (tag, usage_count)
select lower(m[1]), count(*)
from public.videos v, regexp_matches(v.description, '#([^\s#]{1,60})', 'g') m
where v.description is not null
group by lower(m[1])
on conflict (tag) do update set usage_count = excluded.usage_count;

-- ── Live streams: viewer counts on ended streams ──
update public.live_streams set viewer_count = 0 where status <> 'live';

-- ── Verify ──
select 'videos'   as table_name, count(*) as rows,
       sum(likes_count) as total_likes, sum(comments_count) as total_comments,
       sum(saves_count) as total_saves, sum(views_count) as total_views
from public.videos
union all
select 'profiles', count(*), sum(followers_count), sum(following_count), sum(likes_count), 0
from public.profiles;
