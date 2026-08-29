-- ============================================================
-- 0012_moderation.sql
-- Apple/Google UGC compliance requirements:
--   - "Report" on every post/comment/user (reports table + RPC
--     already existed from 0001_init.sql — this adds the missing
--     piece: automatically hiding content once it's reported
--     enough, so moderation happens immediately rather than
--     waiting on a human reviewer)
--   - "Block user" (blocks table + API already existed — this
--     migration doesn't touch that, only adds hide-on-report)
-- ============================================================

-- ── 1. Hide flags on moderatable content ──
alter table public.videos   add column if not exists is_hidden     boolean not null default false;
alter table public.videos   add column if not exists hidden_at     timestamptz;
alter table public.videos   add column if not exists hidden_reason text;

alter table public.comments add column if not exists is_hidden     boolean not null default false;
alter table public.comments add column if not exists hidden_at     timestamptz;
alter table public.comments add column if not exists hidden_reason text;

-- ── 2. RLS: hidden content is invisible to everyone except its owner ──
drop policy if exists "videos read public" on public.videos;
create policy "videos read public" on public.videos
  for select to authenticated, anon
  using ((privacy = 'public' and is_hidden = false) or user_id = auth.uid());

drop policy if exists "comments read public" on public.comments;
create policy "comments read public" on public.comments
  for select to authenticated, anon
  using (is_hidden = false or user_id = auth.uid());

-- ── 3. Auto-hide on report threshold ──
-- 3 distinct reports on the same content within 24h auto-hides it
-- immediately (well within any "review within 24 hours" requirement —
-- this satisfies it instantly rather than waiting on a human).
create or replace function public.auto_hide_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_reports integer;
begin
  select count(distinct reporter_id) into v_recent_reports
  from public.reports
  where target_type = new.target_type
    and target_id = new.target_id
    and created_at >= now() - interval '24 hours';

  if v_recent_reports >= 3 then
    if new.target_type = 'video' then
      update public.videos
        set is_hidden = true, hidden_at = now(), hidden_reason = 'auto: reported ' || v_recent_reports || ' times'
        where id = new.target_id and is_hidden = false;
    elsif new.target_type = 'comment' then
      update public.comments
        set is_hidden = true, hidden_at = now(), hidden_reason = 'auto: reported ' || v_recent_reports || ' times'
        where id = new.target_id and is_hidden = false;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tr_auto_hide_on_report on public.reports;
create trigger tr_auto_hide_on_report
  after insert on public.reports
  for each row execute function public.auto_hide_on_report();

-- ── 4. fetch_fyp_feed: security definer bypasses RLS, so it needs its
-- own explicit is_hidden filter (direct table queries elsewhere are
-- already covered by the RLS policy change above) ──
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
      and v.is_hidden = false
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
