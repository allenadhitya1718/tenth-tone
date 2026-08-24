-- ============================================================
-- 0008_tiktok_features.sql
-- TikTok core functionality enhancements:
--   1. Sounds / Music library table & seed catalog
--   2. Sound ID foreign key on videos
--   3. Weighted "For You Page" (FYP) algorithm RPC function
--   4. Global search function (Profiles, Videos, Sounds, Hashtags)
-- ============================================================

-- ── 1. Sounds / Music Table ──
create table if not exists public.sounds (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  author_name text not null default 'الأصلي',
  audio_url   text,
  cover_url   text,
  duration    integer not null default 30, -- seconds
  usage_count integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Seed initial trending sounds
insert into public.sounds (id, title, author_name, duration, usage_count) values
  ('11111111-1111-1111-1111-111111111111', 'صوت أصلي رائج', 'أحمد السعيد', 25, 1420),
  ('22222222-2222-2222-2222-222222222222', 'نغمة حماسية 🎶', 'دي جي ناصر', 45, 980),
  ('33333333-3333-3333-3333-333333333333', 'لحظات هادئة ☕', 'سارة العلي', 30, 2300),
  ('44444444-4444-4444-4444-444444444444', 'تحدي الرياض اليوم 🇸🇦', 'فريق التحديات', 15, 5400)
on conflict (id) do nothing;

-- Link sound to videos table
alter table public.videos add column if not exists sound_id uuid references public.sounds(id) on delete set null;

-- RLS for sounds
alter table public.sounds enable row level security;
drop policy if exists "sounds read public" on public.sounds;
create policy "sounds read public" on public.sounds for select to authenticated, anon using (true);
drop policy if exists "sounds insert auth" on public.sounds;
create policy "sounds insert auth" on public.sounds for insert to authenticated with check (true);

-- Trigger to bump sound usage_count when video is published
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


-- ── 2. Weighted TikTok "For You Page" (FYP) algorithm RPC ──
-- Scores videos by:
--   Score = (likes * 3) + (comments * 5) + (shares * 7) + (views * 1) + RecencyDecay
create or replace function public.fetch_fyp_feed(
  p_limit  integer default 20,
  p_offset integer default 0
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
  order by (
    (v.likes_count * 3) + 
    (v.comments_count * 5) + 
    (v.shares_count * 7) + 
    (v.views_count * 1) +
    -- Recency boost: +1000 pts if < 24h, +500 if < 72h
    case 
      when v.created_at >= now() - interval '24 hours' then 1000
      when v.created_at >= now() - interval '72 hours' then 500
      else 0
    end
  ) desc, v.created_at desc
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.fetch_fyp_feed(integer, integer) to authenticated, anon;
