-- ============================================================
-- 0029_settings_expansion.sql
--
-- Backing for the settings areas that had no storage behind them:
--
--   videos.is_archived    - hide a post from your profile without deleting it
--   close_friends         - a smaller audience than "followers"
--   data_export_requests  - "download your data", queued for an operator
--   user_settings.*       - activity-status and tagging preferences
--
-- Apply in the Supabase SQL editor AFTER 0001..0028.
-- ============================================================

-- ── Archive ──
-- Separate from is_hidden, which is moderation taking a post down. Archiving
-- is the author's own choice and they can undo it.
alter table public.videos
  add column if not exists is_archived boolean not null default false;

create index if not exists idx_videos_owner_archived
  on public.videos (user_id, is_archived, created_at desc);


-- ── Close friends ──
create table if not exists public.close_friends (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint close_friend_not_self check (user_id <> friend_id)
);

alter table public.close_friends enable row level security;

-- Only the owner of the list may read it. Nobody is told they are on it,
-- which is the same promise Instagram makes.
drop policy if exists "close_friends own" on public.close_friends;
create policy "close_friends own" on public.close_friends
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Download your data ──
create table if not exists public.data_export_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'ready', 'failed')),
  file_url     text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_export_user on public.data_export_requests (user_id, requested_at desc);

alter table public.data_export_requests enable row level security;

drop policy if exists "exports own read" on public.data_export_requests;
create policy "exports own read" on public.data_export_requests
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "exports own insert" on public.data_export_requests;
create policy "exports own insert" on public.data_export_requests
  for insert to authenticated with check (user_id = auth.uid());

-- One open request at a time, so repeated taps do not queue a pile of work.
create unique index if not exists idx_export_one_pending
  on public.data_export_requests (user_id)
  where status = 'pending';


-- ── Extra preferences ──
alter table public.user_settings
  add column if not exists show_activity_status boolean not null default true;

alter table public.user_settings
  add column if not exists who_can_tag text not null default 'everyone';

do $tag$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_settings_who_can_tag_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_who_can_tag_check
      check (who_can_tag in ('everyone', 'following', 'nobody'));
  end if;
end
$tag$;


-- ── Archived posts stay out of the feed ──
-- Identical to 0028 apart from the is_archived exclusion.
create or replace function public.fetch_fyp_feed(
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
  user_name text, user_handle text, user_avatar_url text, user_verified boolean
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
      and (p.banned_until is null or p.banned_until <= now())
      and v.user_id not in (select blocked_id from blocked)
      and v.user_id not in (select muted_id from muted)
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
$fn$;

grant execute on function public.fetch_fyp_feed(integer, integer, uuid, integer) to authenticated, anon;
