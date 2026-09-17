-- ============================================================
-- 0084_feed_in_one_round_trip.sql
--
-- Opening the feed cost three backend calls one after another, then one
-- more per creator on the page:
--
--   1. fetch_fyp_feed            the rows
--   2. videos?select=saves_count  because the RPC did not return it
--   3. likes + saves for me       which of these have I liked / saved
--   4. follows, per creator       does the Follow button say Follow
--
-- Measured from a browser: each call waits 0.2-1.0 s on the API before a
-- byte comes back, and the database is in Tokyo - a long way from the
-- phones this app is for. Nothing on the page can be drawn until 1 and 2
-- are done, and the first frame of video cannot start until then either.
-- The function itself runs in about 2 ms; the time is all in the trips.
--
-- So the function now answers everything in one go. Four columns are
-- added to what it returns:
--
--   saves_count   the column the app was fetching separately
--   liked         true when the CALLER has liked this video
--   saved         true when the CALLER has saved it
--   following     true when the CALLER follows its creator
--
-- The three flags are computed for auth.uid(), never for p_user_id: the
-- parameter is whatever the client sends, and answering "did user X like
-- this" for an arbitrary X would hand anyone another person's likes.
-- Signed out, all three are false.
--
-- Postgres cannot change what a function returns with CREATE OR REPLACE,
-- so it is dropped and recreated inside this one transaction - there is no
-- moment at which the feed does not exist. The parameters are unchanged,
-- so an app that has not been updated keeps working: it simply ignores the
-- columns it does not know about.
-- ============================================================

begin;

drop function if exists public.fetch_fyp_feed(integer, integer, uuid, integer);

create function public.fetch_fyp_feed(
  p_limit            integer default 20,
  p_offset           integer default 0,
  p_user_id          uuid    default null,
  p_max_per_creator  integer default 3
)
returns table (
  id uuid, user_id uuid, description text, music text, sound_id uuid,
  video_url text, thumbnail text, privacy text,
  likes_count integer, comments_count integer, shares_count integer,
  views_count integer, created_at timestamptz,
  user_name text, user_handle text, user_avatar_url text, user_verified boolean,
  saves_count integer, liked boolean, saved boolean, following boolean
)
language sql
security definer
set search_path = public
stable
as $fn$
  with prefs as (
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
  interested_prefs as (
    select v2.user_id as pref_creator
    from public.video_feedback f
    join public.videos v2 on v2.id = f.video_id
    where p_user_id is not null and f.user_id = p_user_id and f.feedback = 'interested'
  ),
  not_interested_videos as (
    select video_id from public.video_feedback
    where p_user_id is not null and user_id = p_user_id and feedback = 'not_interested'
  ),
  not_interested_creators as (
    select v2.user_id as creator_id
    from public.video_feedback f
    join public.videos v2 on v2.id = f.video_id
    where p_user_id is not null and f.user_id = p_user_id and f.feedback = 'not_interested'
    group by v2.user_id
    having count(*) >= 2
  ),
  blocked as (
    select blocked_id from public.blocks
    where p_user_id is not null and blocker_id = p_user_id
  ),
  muted as (
    select muted_id from public.muted_users
    where p_user_id is not null and user_id = p_user_id
  ),
  scored as (
    select
      v.id, v.user_id, v.description, v.music, v.sound_id, v.video_url, v.thumbnail, v.privacy,
      v.likes_count, v.comments_count, v.shares_count, v.views_count, v.created_at,
      v.saves_count,
      p.name as user_name, p.handle as user_handle,
      p.avatar_url as user_avatar_url, p.verified as user_verified,
      (
        (v.likes_count * 3) + (v.comments_count * 5) +
        (v.shares_count * 7) + (v.views_count * 1) +
        case
          when v.created_at >= now() - interval '24 hours' then 1000
          when v.created_at >= now() - interval '72 hours' then 500
          else 0
        end +
        case when exists (select 1 from prefs where pref_creator = v.user_id) then 2000 else 0 end +
        case when v.sound_id is not null and exists (select 1 from prefs where pref_sound = v.sound_id) then 800 else 0 end +
        case when exists (select 1 from liked_prefs where pref_creator = v.user_id) then 1500 else 0 end +
        case when exists (select 1 from interested_prefs where pref_creator = v.user_id) then 1200 else 0 end
      ) as score
    from public.videos v
    join public.profiles p on p.id = v.user_id
    where v.is_draft = false
      and v.privacy = 'public'
      and coalesce(v.is_hidden, false) = false
      and coalesce(v.is_archived, false) = false
      and p.deactivated_at is null
      and (p.banned_until is null or p.banned_until <= now())
      and (
        not coalesce(p.is_private, false)
        or v.user_id = p_user_id
        or (p_user_id is not null and exists (
              select 1 from public.follows f2
               where f2.follower_id = p_user_id and f2.followed_id = v.user_id))
      )
      and v.user_id not in (select blocked_id from blocked)
      and v.user_id not in (select muted_id from muted)
      and v.id not in (select video_id from not_interested_videos)
      and v.user_id not in (select creator_id from not_interested_creators)
  ),
  ranked as (
    select *,
      row_number() over (partition by user_id order by score desc, created_at desc) as creator_rank
    from scored
  ),
  page as (
    select *
    from ranked
    where creator_rank <= greatest(p_max_per_creator, 1)
    order by score desc, created_at desc
    limit p_limit
    offset p_offset
  )
  select id, user_id, description, music, sound_id, video_url, thumbnail, privacy,
         likes_count, comments_count, shares_count, views_count, created_at,
         user_name, user_handle, user_avatar_url, user_verified,
         coalesce(saves_count, 0) as saves_count,
         (auth.uid() is not null and exists (
            select 1 from public.likes l
             where l.user_id = auth.uid() and l.video_id = page.id)) as liked,
         (auth.uid() is not null and exists (
            select 1 from public.saves s
             where s.user_id = auth.uid() and s.video_id = page.id)) as saved,
         (auth.uid() is not null and exists (
            select 1 from public.follows f
             where f.follower_id = auth.uid() and f.followed_id = page.user_id)) as following
  from page
  order by score desc, created_at desc;
$fn$;

grant execute on function public.fetch_fyp_feed(integer, integer, uuid, integer) to authenticated, anon;

-- PostgREST caches function signatures; without this the API could keep
-- answering with the old shape until its next reload.
notify pgrst, 'reload schema';

commit;
