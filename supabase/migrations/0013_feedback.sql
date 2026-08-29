-- ============================================================
-- 0013_feedback.sql
-- "Interested" / "Not interested" feedback (like Instagram's post
-- menu). This is a real negative signal for the algorithm — up to
-- now it only had positive signals (likes, watch time, replays);
-- "Not interested" tells it to actively stop showing similar
-- content, which no amount of positive-signal tuning can replicate.
-- ============================================================

create table if not exists public.video_feedback (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  video_id   uuid not null references public.videos   (id) on delete cascade,
  feedback   text not null check (feedback in ('interested', 'not_interested')),
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists idx_video_feedback_user on public.video_feedback (user_id, feedback);

alter table public.video_feedback enable row level security;
drop policy if exists "feedback own read" on public.video_feedback;
create policy "feedback own read" on public.video_feedback
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "feedback own write" on public.video_feedback;
create policy "feedback own write" on public.video_feedback
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.set_video_feedback(
  p_video_id uuid,
  p_feedback text
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
  if p_feedback not in ('interested', 'not_interested') then
    raise exception 'invalid feedback value';
  end if;

  insert into public.video_feedback (user_id, video_id, feedback)
  values (v_user, p_video_id, p_feedback)
  on conflict (user_id, video_id) do update set
    feedback = excluded.feedback,
    created_at = now();
end;
$$;

grant execute on function public.set_video_feedback(uuid, text) to authenticated;

-- ── fetch_fyp_feed: exclude creators marked "not interested",
-- lightly boost creators marked "interested" ──
drop function if exists public.fetch_fyp_feed(integer, integer, uuid, integer);

create or replace function public.fetch_fyp_feed(
  p_limit           integer default 20,
  p_offset          integer default 0,
  p_user_id         uuid    default null,
  p_max_per_creator integer default 3
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
    -- Marking 2+ videos from the same creator "not interested" suppresses that creator entirely
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
        case when exists (select 1 from liked_prefs where pref_creator = v.user_id) then 1500 else 0 end +
        case when exists (select 1 from interested_prefs where pref_creator = v.user_id) then 1200 else 0 end
      ) as score
    from public.videos v
    join public.profiles p on p.id = v.user_id
    where v.is_draft = false
      and v.privacy = 'public'
      and v.is_hidden = false
      and (p.banned_until is null or p.banned_until <= now())
      and v.user_id not in (select blocked_id from blocked)
      and v.id not in (select video_id from not_interested_videos)
      and v.user_id not in (select creator_id from not_interested_creators)
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
