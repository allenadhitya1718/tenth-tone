-- ============================================================
-- 0016_live_chat_hashtags.sql
-- Backing tables for the last screens still running on mock data:
--   1. live_comments  — the live-stream chat was entirely fake
--      (5 hardcoded messages); this makes it real + realtime.
--   2. live_streams.category — the category chips on the live list
--      filtered against a mock 'tag' field that had no column.
--   3. hashtags       — the "trending" row on Discover was a static
--      list; this derives real counts from published videos.
-- ============================================================

-- ── 1. Live stream chat ──
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
    -- can't comment on a stream you're blocked from, or one that ended
    and exists (
      select 1 from public.live_streams ls
      where ls.id = live_stream_id
        and ls.status = 'live'
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

-- ── 2. Live stream categories (the chips on the live list) ──
alter table public.live_streams add column if not exists category text;
create index if not exists idx_live_streams_category on public.live_streams (category) where status = 'live';

-- ── 3. Hashtags ──
create table if not exists public.hashtags (
  tag         text primary key,
  usage_count integer not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_hashtags_usage on public.hashtags (usage_count desc);

alter table public.hashtags enable row level security;
drop policy if exists "hashtags read" on public.hashtags;
create policy "hashtags read" on public.hashtags
  for select to authenticated, anon using (true);
-- Writes happen only through the trigger below (security definer).

-- Extracts #tags from a video description and keeps usage_count in sync.
create or replace function public.sync_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
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
end;
$$;

drop trigger if exists tr_sync_hashtags on public.videos;
create trigger tr_sync_hashtags
  after insert or update of description or delete on public.videos
  for each row execute function public.sync_hashtags();

-- ── 4. saves_count on videos ──
-- The feed renders a saves counter but no column backed it, so the UI
-- was showing a fabricated number. Add the column, backfill it, and keep
-- it in sync the same way likes_count is.
alter table public.videos add column if not exists saves_count integer not null default 0;

update public.videos v
  set saves_count = (select count(*) from public.saves s where s.video_id = v.id)
  where v.saves_count = 0;

create or replace function public.bump_saves_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.videos set saves_count = saves_count + 1 where id = new.video_id;
  elsif tg_op = 'DELETE' then
    update public.videos set saves_count = greatest(saves_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_saves_count on public.saves;
create trigger tr_saves_count
  after insert or delete on public.saves
  for each row execute function public.bump_saves_count();

-- ── 5. Share counter ──
-- The share screen now actually sends the video; this records it.
create or replace function public.increment_share_count(p_video_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.videos set shares_count = shares_count + 1 where id = p_video_id;
end;
$$;

grant execute on function public.increment_share_count(uuid) to authenticated;

-- ── 6. Realtime for live chat ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_comments'
  ) then
    alter publication supabase_realtime add table public.live_comments;
  end if;
end $$;
