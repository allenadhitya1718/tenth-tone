-- ============================================================
-- 0023_original_sounds.sql
-- Makes "original sounds" real.
--
-- The sounds table existed and videos already had sound_id, but nothing
-- ever created a sound, so the only rows were four seeded placeholders
-- with no audio behind them. This migration:
--   * links a sound back to the person and video it came from
--   * keeps usage_count accurate via a trigger instead of a stored guess
--   * adds sound favourites
--   * clears out the placeholder rows
--
-- No music licensing is involved: an original sound is the audio of a
-- user's own video, which is their content.
--
-- Apply in the Supabase SQL editor AFTER 0001..0022.
-- ============================================================

alter table public.sounds add column if not exists created_by      uuid references public.profiles (id) on delete set null;
alter table public.sounds add column if not exists origin_video_id uuid references public.videos   (id) on delete set null;
alter table public.sounds add column if not exists is_original     boolean not null default true;

create index if not exists idx_sounds_usage on public.sounds (usage_count desc, created_at desc);

-- Only the creator may edit or remove their own sound.
drop policy if exists "sounds update own" on public.sounds;
create policy "sounds update own" on public.sounds
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "sounds delete own" on public.sounds;
create policy "sounds delete own" on public.sounds
  for delete to authenticated using (created_by = auth.uid());

-- ── usage_count follows reality ──
create or replace function public.sync_sound_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.sound_id is not null then
    update public.sounds set usage_count = greatest(usage_count - 1, 0) where id = old.sound_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.sound_id is not null then
    update public.sounds set usage_count = usage_count + 1 where id = new.sound_id;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_sync_sound_usage on public.videos;
create trigger tr_sync_sound_usage
  after insert or update of sound_id or delete on public.videos
  for each row execute function public.sync_sound_usage();

-- ── Favourites ──
create table if not exists public.sound_favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  sound_id   uuid not null references public.sounds   (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sound_id)
);

alter table public.sound_favorites enable row level security;

drop policy if exists "sound_favorites own" on public.sound_favorites;
create policy "sound_favorites own" on public.sound_favorites
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Clear the placeholder sounds ──
-- They had no audio_url and showed as "trending" with zero videos.
update public.videos set sound_id = null
 where sound_id in ('11111111-1111-1111-1111-111111111111',
                    '22222222-2222-2222-2222-222222222222',
                    '33333333-3333-3333-3333-333333333333',
                    '44444444-4444-4444-4444-444444444444');

delete from public.sounds
 where id in ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333',
              '44444444-4444-4444-4444-444444444444');

-- Recount anything left, so no fabricated numbers survive.
update public.sounds s
   set usage_count = (select count(*) from public.videos v where v.sound_id = s.id);

-- ── Backfill: give every existing public video an original sound ──
-- Without this, videos posted before this change have no sound, so the music
-- disc in the feed has nothing to open. Their `music` column held seeded
-- fake song titles ("هزّة - سارة"), which are replaced by the real creator.
with created as (
  insert into public.sounds (title, author_name, audio_url, cover_url, duration,
                             created_by, origin_video_id, is_original)
  select 'صوت أصلي',
         coalesce(nullif(p.name, ''), p.handle, ''),
         v.video_url,
         v.thumbnail,
         30,
         v.user_id,
         v.id,
         true
    from public.videos v
    join public.profiles p on p.id = v.user_id
   where v.sound_id is null
     and v.is_draft = false
  returning id, origin_video_id, author_name
)
update public.videos v
   set sound_id = c.id,
       music    = 'صوت أصلي - ' || c.author_name
  from created c
 where v.id = c.origin_video_id;

-- Recount again now the backfill has linked everything.
update public.sounds s
   set usage_count = (select count(*) from public.videos v where v.sound_id = s.id);
