-- =============================================================
-- FLYP — Initial schema (full SRS coverage, future-proof)
-- Run this once in Supabase SQL Editor.
-- Phase 1 actively uses: profiles. Other tables are scaffolded
-- now so later phases don't need migrations on top of live data.
-- =============================================================

-- Enable extensions we'll use (Supabase has these available; uuid-ossp & pgcrypto pre-enabled)
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- =============================================================
-- profiles — extends auth.users
-- =============================================================
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  handle          text unique,                            -- @username
  name            text not null default '',
  bio             text default '',
  avatar_url      text,
  verified        boolean not null default false,
  followers_count integer not null default 0,
  following_count integer not null default 0,
  likes_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Case-insensitive unique index on handle (replaces citext)
create unique index if not exists profiles_handle_lower_idx on public.profiles (lower(handle));

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, handle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), ''),
    coalesce(new.raw_user_meta_data->>'handle', 'user_' || substr(new.id::text, 1, 8))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Touch updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

-- =============================================================
-- follows
-- =============================================================
create table if not exists public.follows (
  follower_id uuid references public.profiles (id) on delete cascade,
  followed_id uuid references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

-- Maintain counts
create or replace function public.bump_follow_counts()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    update public.profiles set followers_count = followers_count + 1 where id = new.followed_id;
  elsif (tg_op = 'DELETE') then
    update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    update public.profiles set followers_count = greatest(followers_count - 1, 0) where id = old.followed_id;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_follows on public.follows;
create trigger tr_follows after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

-- =============================================================
-- videos
-- =============================================================
create table if not exists public.videos (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  description  text default '',
  music        text,
  video_url    text,           -- supabase storage URL
  thumbnail    text,
  privacy      text not null default 'public' check (privacy in ('public', 'friends', 'private')),
  likes_count  integer not null default 0,
  comments_count integer not null default 0,
  shares_count integer not null default 0,
  views_count  integer not null default 0,
  is_draft     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_videos_user_created on public.videos (user_id, created_at desc);
create index if not exists idx_videos_recent on public.videos (created_at desc) where is_draft = false;

-- =============================================================
-- likes / saves / comments / shares
-- =============================================================
create table if not exists public.likes (
  user_id   uuid references public.profiles (id) on delete cascade,
  video_id  uuid references public.videos   (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists public.saves (
  user_id   uuid references public.profiles (id) on delete cascade,
  video_id  uuid references public.videos   (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists public.comments (
  id          uuid primary key default uuid_generate_v4(),
  video_id    uuid not null references public.videos (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  parent_id   uuid references public.comments (id) on delete cascade,
  text        text not null,
  likes_count integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_comments_video on public.comments (video_id, created_at desc);

-- =============================================================
-- chats — both 1:1 and group
-- =============================================================
create table if not exists public.chats (
  id          uuid primary key default uuid_generate_v4(),
  type        text not null check (type in ('dm', 'group')),
  name        text,                            -- group only
  photo_url   text,                            -- group only
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id    uuid references public.chats (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists idx_chat_members_user on public.chat_members (user_id);

create table if not exists public.messages (
  id          uuid primary key default uuid_generate_v4(),
  chat_id     uuid not null references public.chats (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  type        text not null default 'text' check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system')),
  text        text,
  attachment_url text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_messages_chat_created on public.messages (chat_id, created_at desc);

-- =============================================================
-- notifications
-- =============================================================
create table if not exists public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  type        text not null check (type in ('like', 'comment', 'follow', 'mention', 'message', 'system')),
  payload     jsonb default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifs_user_created on public.notifications (user_id, created_at desc);

-- =============================================================
-- live location (Phase 4)
-- =============================================================
create table if not exists public.user_locations (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  lat              double precision,
  lng              double precision,
  accuracy         real,
  visibility       text not null default 'friends' check (visibility in ('public', 'friends', 'none')),
  sharing_enabled  boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- =============================================================
-- live streams (Phase 5)
-- =============================================================
create table if not exists public.live_streams (
  id          uuid primary key default uuid_generate_v4(),
  host_id     uuid not null references public.profiles (id) on delete cascade,
  title       text,
  thumbnail   text,
  viewer_count integer not null default 0,
  viewer_count_max integer not null default 0,
  status      text not null default 'live' check (status in ('live', 'ended', 'banned')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

-- =============================================================
-- gifts catalog + transactions (Phase 5)
-- =============================================================
create table if not exists public.gifts (
  id     text primary key,
  name   text not null,
  emoji  text,
  price  integer not null,
  active boolean not null default true
);

insert into public.gifts (id, name, emoji, price) values
  ('rose', 'وردة', '🌹', 1),
  ('heart', 'قلب', '💖', 5),
  ('star', 'نجمة', '⭐', 10),
  ('trophy', 'كأس', '🏆', 50),
  ('crown', 'تاج', '👑', 200),
  ('rocket', 'صاروخ', '🚀', 500),
  ('yacht', 'يخت', '🛥️', 1000),
  ('car', 'سيارة', '🏎️', 2000)
on conflict (id) do nothing;

create table if not exists public.gift_transactions (
  id              uuid primary key default uuid_generate_v4(),
  from_user_id    uuid not null references public.profiles (id) on delete cascade,
  to_user_id      uuid not null references public.profiles (id) on delete cascade,
  gift_id         text not null references public.gifts (id),
  live_stream_id  uuid references public.live_streams (id) on delete set null,
  amount          integer not null,
  created_at      timestamptz not null default now()
);

-- =============================================================
-- wallet (Phase 5)
-- =============================================================
create table if not exists public.wallets (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  balance  integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in ('topup', 'gift_sent', 'gift_received', 'withdrawal')),
  amount      integer not null,
  reference   uuid,
  description text,
  created_at  timestamptz not null default now()
);

-- =============================================================
-- reports + admin (Phase 6)
-- =============================================================
create table if not exists public.reports (
  id            uuid primary key default uuid_generate_v4(),
  reporter_id   uuid references public.profiles (id) on delete set null,
  target_type   text not null check (target_type in ('video', 'comment', 'user', 'live_stream')),
  target_id     uuid not null,
  reason        text not null,
  status        text not null default 'pending' check (status in ('pending', 'reviewed', 'resolved', 'dismissed')),
  action_taken  text,
  resolved_by   uuid references public.profiles (id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_reports_status on public.reports (status, created_at desc);

create table if not exists public.admin_logs (
  id          uuid primary key default uuid_generate_v4(),
  admin_id    uuid references public.profiles (id),
  action      text not null,
  target_type text,
  target_id   uuid,
  payload     jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

-- =============================================================
-- Row Level Security
-- =============================================================
alter table public.profiles            enable row level security;
alter table public.follows             enable row level security;
alter table public.videos              enable row level security;
alter table public.likes               enable row level security;
alter table public.saves               enable row level security;
alter table public.comments            enable row level security;
alter table public.chats               enable row level security;
alter table public.chat_members        enable row level security;
alter table public.messages            enable row level security;
alter table public.notifications       enable row level security;
alter table public.user_locations      enable row level security;
alter table public.live_streams        enable row level security;
alter table public.gifts               enable row level security;
alter table public.gift_transactions   enable row level security;
alter table public.wallets             enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.reports             enable row level security;
alter table public.admin_logs          enable row level security;

-- profiles
drop policy if exists "profiles read public" on public.profiles;
create policy "profiles read public" on public.profiles for select to authenticated, anon using (true);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (auth.uid() = id);

-- follows
drop policy if exists "follows read public" on public.follows;
create policy "follows read public" on public.follows for select to authenticated, anon using (true);

drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows for insert to authenticated with check (auth.uid() = follower_id);

drop policy if exists "follows delete own" on public.follows;
create policy "follows delete own" on public.follows for delete to authenticated using (auth.uid() = follower_id);

-- videos
drop policy if exists "videos read public" on public.videos;
create policy "videos read public" on public.videos for select to authenticated, anon using (privacy = 'public' or user_id = auth.uid());

drop policy if exists "videos write own" on public.videos;
create policy "videos write own" on public.videos for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- likes / saves
drop policy if exists "likes read public" on public.likes;
create policy "likes read public" on public.likes for select to authenticated, anon using (true);
drop policy if exists "likes write own" on public.likes;
create policy "likes write own" on public.likes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "saves write own" on public.saves;
create policy "saves write own" on public.saves for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- comments
drop policy if exists "comments read public" on public.comments;
create policy "comments read public" on public.comments for select to authenticated, anon using (true);
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete to authenticated using (auth.uid() = user_id);

-- chats — only members can read
drop policy if exists "chats members read" on public.chats;
create policy "chats members read" on public.chats for select to authenticated using (
  exists (select 1 from public.chat_members where chat_id = chats.id and user_id = auth.uid())
);
drop policy if exists "chats create own" on public.chats;
create policy "chats create own" on public.chats for insert to authenticated with check (auth.uid() = created_by);

-- chat_members
drop policy if exists "chat_members self read" on public.chat_members;
create policy "chat_members self read" on public.chat_members for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.chat_members m2 where m2.chat_id = chat_members.chat_id and m2.user_id = auth.uid())
);

-- messages
drop policy if exists "messages members read" on public.messages;
create policy "messages members read" on public.messages for select to authenticated using (
  exists (select 1 from public.chat_members where chat_id = messages.chat_id and user_id = auth.uid())
);
drop policy if exists "messages members insert" on public.messages;
create policy "messages members insert" on public.messages for insert to authenticated with check (
  auth.uid() = from_user_id and exists (select 1 from public.chat_members where chat_id = messages.chat_id and user_id = auth.uid())
);

-- notifications — own only
drop policy if exists "notifications own" on public.notifications;
create policy "notifications own" on public.notifications for select to authenticated using (user_id = auth.uid());

-- user_locations — visible per privacy
drop policy if exists "locations read" on public.user_locations;
create policy "locations read" on public.user_locations for select to authenticated using (
  visibility = 'public'
  or user_id = auth.uid()
  or (
    visibility = 'friends'
    and exists (select 1 from public.follows where follower_id = auth.uid() and followed_id = user_id)
  )
);
drop policy if exists "locations write own" on public.user_locations;
create policy "locations write own" on public.user_locations for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- gifts catalog — public read
drop policy if exists "gifts read" on public.gifts;
create policy "gifts read" on public.gifts for select to authenticated, anon using (active = true);

-- wallet — own only
drop policy if exists "wallet own read" on public.wallets;
create policy "wallet own read" on public.wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists "wallet_tx own read" on public.wallet_transactions;
create policy "wallet_tx own read" on public.wallet_transactions for select to authenticated using (user_id = auth.uid());

-- live_streams — public read
drop policy if exists "live read" on public.live_streams;
create policy "live read" on public.live_streams for select to authenticated, anon using (status <> 'banned');

-- reports — only the reporter can see their own
drop policy if exists "reports own read" on public.reports;
create policy "reports own read" on public.reports for select to authenticated using (reporter_id = auth.uid());
drop policy if exists "reports insert" on public.reports;
create policy "reports insert" on public.reports for insert to authenticated with check (auth.uid() = reporter_id);

-- =============================================================
-- Storage buckets — created via Supabase UI or these SQL inserts
-- =============================================================
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('videos', 'videos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('chat-media', 'chat-media', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('group-photos', 'group-photos', true)
  on conflict (id) do nothing;

-- Storage policies
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select to authenticated, anon using (bucket_id = 'avatars');

drop policy if exists "avatars own write" on storage.objects;
create policy "avatars own write" on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "avatars own update" on storage.objects;
create policy "avatars own update" on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "videos public read" on storage.objects;
create policy "videos public read" on storage.objects for select to authenticated, anon using (bucket_id = 'videos');
drop policy if exists "videos own write" on storage.objects;
create policy "videos own write" on storage.objects for insert to authenticated with check (
  bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text
);
