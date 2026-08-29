-- ============================================================
-- APPLY_PENDING.sql  —  everything the database is still missing
--
-- Migrations 0001–0007 are already applied to this project.
-- This file is the consolidated FINAL STATE of 0008–0016, with the
-- redundancy removed: those files rebuilt fetch_fyp_feed five times,
-- track_engagement twice and auto_hide_on_report twice as features
-- were added, so only the last version of each is kept here.
--
-- Run once: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run (idempotent throughout).
--
-- Not included: 0015_ai_moderation.sql — that pipeline stays inert
-- until a moderation API account exists, and it needs the pg_net
-- extension. Apply it separately when that's set up.
-- ============================================================


-- ============================================================
-- 1. SOUNDS
-- ============================================================
create table if not exists public.sounds (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  author_name text not null default 'الأصلي',
  audio_url   text,
  cover_url   text,
  duration    integer not null default 30,
  usage_count integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.sounds (id, title, author_name, duration, usage_count) values
  ('11111111-1111-1111-1111-111111111111', 'صوت أصلي رائج', 'أحمد السعيد', 25, 1420),
  ('22222222-2222-2222-2222-222222222222', 'نغمة حماسية 🎶', 'دي جي ناصر', 45, 980),
  ('33333333-3333-3333-3333-333333333333', 'لحظات هادئة ☕', 'سارة العلي', 30, 2300),
  ('44444444-4444-4444-4444-444444444444', 'تحدي الرياض اليوم 🇸🇦', 'فريق التحديات', 15, 5400)
on conflict (id) do nothing;

alter table public.videos add column if not exists sound_id uuid references public.sounds(id) on delete set null;

alter table public.sounds enable row level security;
drop policy if exists "sounds read public" on public.sounds;
create policy "sounds read public" on public.sounds for select to authenticated, anon using (true);
drop policy if exists "sounds insert auth" on public.sounds;
create policy "sounds insert auth" on public.sounds for insert to authenticated with check (true);

create or replace function public.bump_sound_usage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.sound_id is not null) then
    update public.sounds set usage_count = usage_count + 1 where id = new.sound_id;
  elsif (tg_op = 'DELETE' and old.sound_id is not null) then
    update public.sounds set usage_count = greatest(usage_count - 1, 0) where id = old.sound_id;
  elsif (tg_op = 'UPDATE' and old.sound_id is distinct from new.sound_id) then
    if old.sound_id is not null then
      update public.sounds set usage_count = greatest(usage_count - 1, 0) where id = old.sound_id;
    end if;
    if new.sound_id is not null then
      update public.sounds set usage_count = usage_count + 1 where id = new.sound_id;
    end if;
  end if;
  return null;
end; $$;

drop trigger if exists tr_sound_usage on public.videos;
create trigger tr_sound_usage after insert or update or delete on public.videos
  for each row execute function public.bump_sound_usage();


-- ============================================================
-- 2. UPLOAD LIMITS (matches client-side checks in web/js/compress.js)
-- ============================================================
update storage.buckets set file_size_limit = 200 * 1024 * 1024 where id = 'videos';
update storage.buckets set file_size_limit =  10 * 1024 * 1024 where id = 'avatars';
update storage.buckets set file_size_limit =  50 * 1024 * 1024 where id = 'chat-media';
update storage.buckets set file_size_limit =  10 * 1024 * 1024 where id = 'group-photos';


-- ============================================================
-- 3. NEW COLUMNS ON EXISTING TABLES
-- ============================================================
-- Moderation
alter table public.videos   add column if not exists is_hidden     boolean not null default false;
alter table public.videos   add column if not exists hidden_at     timestamptz;
alter table public.videos   add column if not exists hidden_reason text;
alter table public.comments add column if not exists is_hidden     boolean not null default false;
alter table public.comments add column if not exists hidden_at     timestamptz;
alter table public.comments add column if not exists hidden_reason text;

-- Save counter (the feed showed a saves number with no column behind it)
alter table public.videos add column if not exists saves_count integer not null default 0;
update public.videos v set saves_count = (select count(*) from public.saves s where s.video_id = v.id)
  where v.saves_count = 0;

-- Community Guidelines acceptance (Apple Guideline 1.2)
alter table public.profiles add column if not exists guidelines_accepted_at timestamptz;

-- Live stream categories
alter table public.live_streams add column if not exists category text;
create index if not exists idx_live_streams_category on public.live_streams (category) where status = 'live';


-- ============================================================
-- 4. ENGAGEMENT TRACKING  (personalized feed signals)
-- ============================================================
create table if not exists public.video_engagement (
  user_id            uuid not null references public.profiles (id) on delete cascade,
  video_id           uuid not null references public.videos   (id) on delete cascade,
  watch_count        integer not null default 0,
  total_watch_ms     bigint  not null default 0,
  max_completion_pct numeric(4,3) not null default 0,
  last_watched_at    timestamptz,
  created_at         timestamptz not null default now(),
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

create or replace function public.track_engagement(
  p_video_id       uuid,
  p_watch_ms       integer default 0,
  p_loop_count     integer default 0,
  p_completion_pct numeric default 0
)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_video_id is null then return; end if;
  insert into public.video_engagement (user_id, video_id, watch_count, total_watch_ms, max_completion_pct, last_watched_at)
  values (v_user, p_video_id, greatest(p_loop_count,0) + 1, greatest(p_watch_ms,0), least(greatest(p_completion_pct,0),1), now())
  on conflict (user_id, video_id) do update set
    watch_count        = public.video_engagement.watch_count + greatest(p_loop_count,0) + 1,
    total_watch_ms     = public.video_engagement.total_watch_ms + greatest(p_watch_ms,0),
    max_completion_pct = greatest(public.video_engagement.max_completion_pct, least(greatest(p_completion_pct,0),1)),
    last_watched_at    = now();
end; $$;

grant execute on function public.track_engagement(uuid, integer, integer, numeric) to authenticated;


-- ============================================================
-- 5. INTERESTED / NOT INTERESTED
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

create or replace function public.set_video_feedback(p_video_id uuid, p_feedback text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_video_id is null then return; end if;
  if p_feedback not in ('interested', 'not_interested') then raise exception 'invalid feedback value'; end if;
  insert into public.video_feedback (user_id, video_id, feedback)
  values (v_user, p_video_id, p_feedback)
  on conflict (user_id, video_id) do update set feedback = excluded.feedback, created_at = now();
end; $$;

grant execute on function public.set_video_feedback(uuid, text) to authenticated;


-- ============================================================
-- 6. MODERATION  (report → auto-hide, admin reversal)
-- ============================================================
drop policy if exists "videos read public" on public.videos;
create policy "videos read public" on public.videos
  for select to authenticated, anon
  using ((privacy = 'public' and is_hidden = false) or user_id = auth.uid());

drop policy if exists "comments read public" on public.comments;
create policy "comments read public" on public.comments
  for select to authenticated, anon
  using (is_hidden = false or user_id = auth.uid());

-- 5 distinct reporters within 24h auto-hides the content immediately.
create or replace function public.auto_hide_on_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_recent_reports integer;
begin
  select count(distinct reporter_id) into v_recent_reports
  from public.reports
  where target_type = new.target_type and target_id = new.target_id
    and created_at >= now() - interval '24 hours';

  if v_recent_reports >= 5 then
    if new.target_type = 'video' then
      update public.videos set is_hidden = true, hidden_at = now(),
        hidden_reason = 'auto: reported ' || v_recent_reports || ' times'
        where id = new.target_id and is_hidden = false;
    elsif new.target_type = 'comment' then
      update public.comments set is_hidden = true, hidden_at = now(),
        hidden_reason = 'auto: reported ' || v_recent_reports || ' times'
        where id = new.target_id and is_hidden = false;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists tr_auto_hide_on_report on public.reports;
create trigger tr_auto_hide_on_report after insert on public.reports
  for each row execute function public.auto_hide_on_report();

-- Reversal path: an admin dismissing a false report restores the content.
create or replace function public.admin_unhide_content(p_target_type text, p_target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_target_type = 'video' then
    update public.videos set is_hidden = false, hidden_at = null, hidden_reason = null where id = p_target_id;
  elsif p_target_type = 'comment' then
    update public.comments set is_hidden = false, hidden_at = null, hidden_reason = null where id = p_target_id;
  else
    raise exception 'unsupported target_type for unhide';
  end if;
  insert into public.admin_logs (admin_id, action, target_type, target_id)
  values (auth.uid(), 'unhide_content', p_target_type, p_target_id);
end; $$;

grant execute on function public.admin_unhide_content(text, uuid) to authenticated;

create or replace function public.accept_guidelines()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set guidelines_accepted_at = now() where id = auth.uid();
end; $$;

grant execute on function public.accept_guidelines() to authenticated;


-- ============================================================
-- 7. LIVE CHAT
-- ============================================================
create table if not exists public.live_comments (
  id             uuid primary key default uuid_generate_v4(),
  live_stream_id uuid not null references public.live_streams (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  text           text not null check (char_length(text) between 1 and 500),
  created_at     timestamptz not null default now()
);
create index if not exists idx_live_comments_stream on public.live_comments (live_stream_id, created_at desc);

alter table public.live_comments enable row level security;

drop policy if exists "live comments read" on public.live_comments;
create policy "live comments read" on public.live_comments
  for select to authenticated, anon using (true);

drop policy if exists "live comments insert own" on public.live_comments;
create policy "live comments insert own" on public.live_comments
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.live_streams ls
      where ls.id = live_stream_id and ls.status = 'live'
        and not exists (
          select 1 from public.blocks b
          where b.blocker_id = ls.host_id and b.blocked_id = auth.uid()
        )
    )
  );

drop policy if exists "live comments delete own or host" on public.live_comments;
create policy "live comments delete own or host" on public.live_comments
  for delete to authenticated using (
    auth.uid() = user_id
    or exists (select 1 from public.live_streams ls where ls.id = live_stream_id and ls.host_id = auth.uid())
    or public.is_admin()
  );


-- ============================================================
-- 8. HASHTAGS  (real trending counts)
-- ============================================================
create table if not exists public.hashtags (
  tag         text primary key,
  usage_count integer not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_hashtags_usage on public.hashtags (usage_count desc);

alter table public.hashtags enable row level security;
drop policy if exists "hashtags read" on public.hashtags;
create policy "hashtags read" on public.hashtags for select to authenticated, anon using (true);

create or replace function public.sync_hashtags()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if tg_op in ('DELETE', 'UPDATE') and old.description is not null then
    for t in select distinct lower(m[1]) from regexp_matches(old.description, '#([^\s#]{1,60})', 'g') m loop
      update public.hashtags set usage_count = greatest(usage_count - 1, 0), updated_at = now() where tag = t;
    end loop;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.description is not null then
    for t in select distinct lower(m[1]) from regexp_matches(new.description, '#([^\s#]{1,60})', 'g') m loop
      insert into public.hashtags (tag, usage_count) values (t, 1)
      on conflict (tag) do update set usage_count = public.hashtags.usage_count + 1, updated_at = now();
    end loop;
  end if;
  return null;
end; $$;

drop trigger if exists tr_sync_hashtags on public.videos;
create trigger tr_sync_hashtags after insert or update of description or delete on public.videos
  for each row execute function public.sync_hashtags();

-- Backfill from videos that already exist
insert into public.hashtags (tag, usage_count)
select lower(m[1]) as tag, count(*)
from public.videos v, regexp_matches(v.description, '#([^\s#]{1,60})', 'g') m
where v.description is not null
group by lower(m[1])
on conflict (tag) do nothing;


-- ============================================================
-- 9. SAVE + SHARE COUNTERS
-- ============================================================
create or replace function public.bump_saves_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.videos set saves_count = saves_count + 1 where id = new.video_id;
  elsif tg_op = 'DELETE' then
    update public.videos set saves_count = greatest(saves_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;

drop trigger if exists tr_saves_count on public.saves;
create trigger tr_saves_count after insert or delete on public.saves
  for each row execute function public.bump_saves_count();

create or replace function public.increment_share_count(p_video_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.videos set shares_count = shares_count + 1 where id = p_video_id;
end; $$;

grant execute on function public.increment_share_count(uuid) to authenticated;


-- ============================================================
-- 10. THE "FOR YOU" FEED  (final version — supersedes all earlier ones)
--
-- Ranking = popularity + recency + personalization, with:
--   • blocked users and hidden content excluded
--   • "not interested" videos excluded; 2+ from one creator suppresses them
--   • at most p_max_per_creator videos from any one creator per page
-- ============================================================
drop function if exists public.fetch_fyp_feed(integer, integer);
drop function if exists public.fetch_fyp_feed(integer, integer, uuid);
drop function if exists public.fetch_fyp_feed(integer, integer, uuid, integer);

create or replace function public.fetch_fyp_feed(
  p_limit           integer default 20,
  p_offset          integer default 0,
  p_user_id         uuid    default null,
  p_max_per_creator integer default 3
)
returns table (
  id uuid, user_id uuid, description text, music text, sound_id uuid,
  video_url text, thumbnail text, privacy text,
  likes_count integer, comments_count integer, shares_count integer, views_count integer,
  created_at timestamptz,
  user_name text, user_handle text, user_avatar_url text, user_verified boolean
)
language sql security definer set search_path = public stable
as $$
  with prefs as (
    select v2.user_id as pref_creator, v2.sound_id as pref_sound
    from public.video_engagement e
    join public.videos v2 on v2.id = e.video_id
    where p_user_id is not null and e.user_id = p_user_id
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
    group by v2.user_id having count(*) >= 2
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
        (v.likes_count * 3) + (v.comments_count * 5) + (v.shares_count * 7) + (v.views_count * 1) +
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
    select *, row_number() over (partition by user_id order by score desc, created_at desc) as creator_rank
    from scored
  )
  select id, user_id, description, music, sound_id, video_url, thumbnail, privacy,
         likes_count, comments_count, shares_count, views_count, created_at,
         user_name, user_handle, user_avatar_url, user_verified
  from ranked
  where creator_rank <= greatest(p_max_per_creator, 1)
  order by score desc, created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.fetch_fyp_feed(integer, integer, uuid, integer) to authenticated, anon;


-- ============================================================
-- 11. REALTIME
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_comments'
  ) then
    alter publication supabase_realtime add table public.live_comments;
  end if;
end $$;
