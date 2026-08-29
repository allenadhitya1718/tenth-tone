-- ============================================================
-- 0028_moderation_tools.sql
-- Hidden words, Restrict, and Mute.
--
-- Until now the only defence against a bad comment was reporting it after
-- the fact, and the only way to deal with a person was a full block - which
-- is confrontational, visible, and so people avoid using it.
--
--   hidden_words     - comments containing these are filtered out for you
--   restricted_users - their comments on your videos are visible only to
--                      them; they cannot tell. They also cannot DM you.
--   muted_users      - their videos stop appearing in your feed, without
--                      unfollowing them
--
-- Apply in the Supabase SQL editor AFTER 0001..0027.
-- ============================================================

-- ── Hidden words ──
create table if not exists public.hidden_words (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  word       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, word)
);

alter table public.hidden_words enable row level security;

drop policy if exists "hidden_words own" on public.hidden_words;
create policy "hidden_words own" on public.hidden_words
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Restricted accounts ──
create table if not exists public.restricted_users (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  restricted_id uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restricted_id),
  constraint restrict_not_self check (user_id <> restricted_id)
);

create index if not exists idx_restricted_by on public.restricted_users (restricted_id);

alter table public.restricted_users enable row level security;

-- Deliberately readable only by the person who set it: the whole point of
-- Restrict is that the restricted person cannot tell.
drop policy if exists "restricted own" on public.restricted_users;
create policy "restricted own" on public.restricted_users
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Muted accounts ──
create table if not exists public.muted_users (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  muted_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_id),
  constraint mute_not_self check (user_id <> muted_id)
);

alter table public.muted_users enable row level security;

drop policy if exists "muted own" on public.muted_users;
create policy "muted own" on public.muted_users
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Restrict blocks direct messages too ──
create or replace function public.may_message(p_target uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_rule text;
begin
  if p_target = p_actor then return true; end if;

  if exists (select 1 from public.blocks
              where blocker_id = p_target and blocked_id = p_actor) then
    return false;
  end if;

  -- A restricted person cannot start a conversation with you.
  if exists (select 1 from public.restricted_users
              where user_id = p_target and restricted_id = p_actor) then
    return false;
  end if;

  v_rule := public.setting_text(p_target, 'who_can_message');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = p_target and followed_id = p_actor);
  end if;
  return true;
end;
$fn$;

grant execute on function public.may_message(uuid, uuid) to authenticated;


-- ── The feed skips muted people ──
-- Same function as 0013 with one extra exclusion. Everything else is
-- unchanged.
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
