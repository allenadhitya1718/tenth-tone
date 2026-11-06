-- ============================================================
-- 0167 - live highlights (client, Nov 2026): after a live, the host trims an
--        interesting minute of it and posts it to Explore.
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0166.
-- Safe to re-run.
--
-- How it works:
--   * The host's phone records the live's audio (everyone on stage, mixed).
--   * After the live the host picks up to 60 seconds; only that minute is
--     uploaded (an AAC audio file, about half a megabyte) through media-upload.
--   * create_live_highlight() files it. The cover is the live's cover photo
--     (the app falls back to the host's picture when the live had none).
--
-- Rules:
--   * only the host of the live, only for their own uploaded audio
--     (media_objects row, stored, owned by them);
--   * 5 to 61 seconds; a title of at most 80 characters;
--   * at most 3 highlights per live and 10 a day per host;
--   * everyone signed in sees them, except across a block and hidden ones;
--   * the host can delete their own; the audio file is then queued for
--     removal (media_delete_queue), like stories.
-- ============================================================

begin;

create table if not exists public.live_highlights (
  id          uuid primary key default gen_random_uuid(),
  live_id     uuid references public.live_streams(id) on delete set null,
  host_id     uuid not null references public.profiles(id) on delete cascade,
  title       text check (title is null or char_length(title) <= 80),
  audio_url   text not null,
  cover_url   text,
  duration_ms integer not null check (duration_ms between 5000 and 61000),
  start_ms    integer not null default 0 check (start_ms >= 0),
  plays_count integer not null default 0,
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists live_highlights_recent_idx on public.live_highlights (created_at desc) where not is_hidden;
create index if not exists live_highlights_host_idx on public.live_highlights (host_id, created_at desc);
create index if not exists live_highlights_live_idx on public.live_highlights (live_id);

alter table public.live_highlights enable row level security;
revoke all on public.live_highlights from anon, authenticated;
grant select on public.live_highlights to authenticated;

drop policy if exists "highlights read" on public.live_highlights;
create policy "highlights read" on public.live_highlights
  for select to authenticated
  using (
    host_id = auth.uid()
    or (not is_hidden and not public.is_blocked_between(host_id, auth.uid()))
  );
-- No insert/update/delete policies: the RPCs below are the only writers.

-- ---------- create ----------
create or replace function public.create_live_highlight(
  p_live_id uuid,
  p_audio_url text,
  p_title text,
  p_start_ms integer,
  p_duration_ms integer
)
returns public.live_highlights
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := auth.uid();
  v_live  record;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_count integer;
  v_row   public.live_highlights;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select id, host_id, thumbnail into v_live from public.live_streams where id = p_live_id;
  if v_live.id is null then
    raise exception 'live_not_found' using errcode = 'P0002';
  end if;
  if v_live.host_id <> v_me then
    raise exception 'not_host' using errcode = '42501';
  end if;
  if p_duration_ms is null or p_duration_ms < 5000 or p_duration_ms > 61000 then
    raise exception 'bad_duration' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 80 then
    raise exception 'title_too_long' using errcode = '22023';
  end if;
  -- Only audio this person actually uploaded and that passed the size check.
  if not exists (
    select 1 from public.media_objects m
     where m.user_id = v_me and m.status = 'stored'
       and m.content_type like 'audio/%'
       and right(p_audio_url, char_length(m.key) + 1) = '/' || m.key
  ) then
    raise exception 'audio_not_uploaded' using errcode = '42501';
  end if;

  select count(*) into v_count from public.live_highlights where live_id = p_live_id;
  if v_count >= 3 then
    raise exception 'highlight_limit_live' using errcode = '23514';
  end if;
  select count(*) into v_count from public.live_highlights
   where host_id = v_me and created_at > now() - interval '1 day';
  if v_count >= 10 then
    raise exception 'highlight_limit_day' using errcode = '23514';
  end if;

  insert into public.live_highlights (live_id, host_id, title, audio_url, cover_url, duration_ms, start_ms)
  values (p_live_id, v_me, v_title, p_audio_url, v_live.thumbnail, p_duration_ms, greatest(coalesce(p_start_ms, 0), 0))
  returning * into v_row;
  return v_row;
end;
$fn$;
revoke all on function public.create_live_highlight(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.create_live_highlight(uuid, text, text, integer, integer) to authenticated;

-- ---------- delete (host only) ----------
create or replace function public.delete_live_highlight(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.live_highlights where id = p_id and host_id = auth.uid();
  return found;
end;
$fn$;
revoke all on function public.delete_live_highlight(uuid) from public, anon;
grant execute on function public.delete_live_highlight(uuid) to authenticated;

-- ---------- a play (counted once per person per highlight per hour) ----------
create table if not exists public.live_highlight_plays (
  highlight_id uuid not null references public.live_highlights(id) on delete cascade,
  user_id      uuid not null,
  played_at    timestamptz not null default now(),
  primary key (highlight_id, user_id)
);
alter table public.live_highlight_plays enable row level security;
revoke all on public.live_highlight_plays from anon, authenticated;

create or replace function public.count_highlight_play(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  insert into public.live_highlight_plays (highlight_id, user_id) values (p_id, v_me)
  on conflict (highlight_id, user_id) do update set played_at = now()
    where public.live_highlight_plays.played_at < now() - interval '1 hour';
  if found then
    update public.live_highlights set plays_count = plays_count + 1 where id = p_id;
  end if;
end;
$fn$;
revoke all on function public.count_highlight_play(uuid) from public, anon;
grant execute on function public.count_highlight_play(uuid) to authenticated;

-- ---------- the audio file goes when the highlight goes ----------
create or replace function public.queue_highlight_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.media_delete_queue (url, source)
  values (old.audio_url, 'live_highlights')
  on conflict (url) do nothing;
  return null;
end;
$fn$;
revoke all on function public.queue_highlight_media() from public, anon, authenticated;
drop trigger if exists trg_queue_highlight_media on public.live_highlights;
create trigger trg_queue_highlight_media
  after delete on public.live_highlights
  for each row execute function public.queue_highlight_media();

-- ---------- the orphan sweep must know these files are in use ----------
create or replace function public.media_key_referenced(p_key text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_pairs text[][] := array[
    ['videos','video_url'], ['videos','thumbnail'],
    ['sounds','audio_url'], ['sounds','cover_url'],
    ['live_streams','thumbnail'], ['live_streams','background_image'],
    ['stories','media_url'], ['stories','poster_url'],
    ['profiles','avatar_url'],
    ['messages','attachment_url'],
    ['chats','photo_url'],
    ['chats','wallpaper_url'],
    ['ads','image_url'],
    ['gifts','asset_url'],
    ['live_highlights','audio_url'], ['live_highlights','cover_url'],
    ['media_delete_queue','url']
  ];
  i int;
  hit boolean;
begin
  if coalesce(p_key, '') = '' then return true; end if;
  for i in 1 .. array_length(v_pairs, 1) loop
    if to_regclass('public.' || v_pairs[i][1]) is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_pairs[i][1]
                      and column_name = v_pairs[i][2]) then
      execute format('select exists (select 1 from public.%I where %I like $1)',
                     v_pairs[i][1], v_pairs[i][2])
        into hit using '%' || p_key;
      if hit then return true; end if;
    end if;
  end loop;
  return false;
end;
$fn$;
revoke all on function public.media_key_referenced(text) from public, anon, authenticated;
grant execute on function public.media_key_referenced(text) to service_role;

commit;

-- Checks (SELECT only)
select 'live_highlights table' as check,
       case when to_regclass('public.live_highlights') is not null then 'OK' else 'MISSING' end as result
union all
select 'create RPC callable',
       case when has_function_privilege('authenticated', 'public.create_live_highlight(uuid,text,text,integer,integer)', 'execute') then 'OK' else 'MISSING' end
union all
select 'no direct writes from the app',
       case when not has_table_privilege('authenticated', 'public.live_highlights', 'insert')
             and not has_table_privilege('authenticated', 'public.live_highlights', 'delete') then 'OK' else 'EXPOSED' end
union all
select 'orphan sweep knows highlights',
       case when pg_get_functiondef('public.media_key_referenced(text)'::regprocedure) like '%live_highlights%' then 'OK' else 'MISSING' end;
