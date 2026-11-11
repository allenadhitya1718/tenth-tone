-- 0170: longer highlights, more per live, longer captions, and voice clips
-- (client, 10-11 Nov 2026; owner chose the details).
--
-- 1. A live highlight can be up to 2 minutes (was 1), and a host can save
--    up to 10 from one live (was 3). The old 10-a-day cap becomes 30 a day
--    across highlights and voice clips, only as a guard against flooding.
-- 2. Captions (the title column) can be up to 150 characters (was 80).
-- 3. Voice clips: a recording made in the app (not from a live), up to 5
--    minutes, with a background photo, posted like a highlight. They live in
--    the same table (kind = 'voice', no live), so Explore, Home and profiles
--    show both without new queries. create_voice_clip() posts one.
--
-- Old app versions keep working: create_live_highlight keeps its arguments.
-- Safe to re-run.

begin;

alter table public.live_highlights
  add column if not exists kind text not null default 'live';

alter table public.live_highlights drop constraint if exists live_highlights_kind_check;
alter table public.live_highlights
  add constraint live_highlights_kind_check check (kind in ('live', 'voice'));

alter table public.live_highlights drop constraint if exists live_highlights_duration_ms_check;
alter table public.live_highlights
  add constraint live_highlights_duration_ms_check check (
    duration_ms >= 5000
    and ((kind = 'live' and duration_ms <= 121000) or (kind = 'voice' and duration_ms <= 301000))
  );

alter table public.live_highlights drop constraint if exists live_highlights_title_check;
alter table public.live_highlights
  add constraint live_highlights_title_check check (title is null or char_length(title) <= 150);

-- ---------- a highlight from a live ----------
create or replace function public.create_live_highlight(
  p_live_id uuid,
  p_audio_url text,
  p_title text,
  p_start_ms integer,
  p_duration_ms integer,
  p_cover_url text default null
)
returns public.live_highlights
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me     uuid := auth.uid();
  v_live   record;
  v_avatar text;
  v_cover  text := nullif(btrim(coalesce(p_cover_url, '')), '');
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_count  integer;
  v_row    public.live_highlights;
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
  if p_duration_ms is null or p_duration_ms < 5000 or p_duration_ms > 121000 then
    raise exception 'bad_duration' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 150 then
    raise exception 'title_too_long' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.media_objects m
     where m.user_id = v_me and m.status = 'stored'
       and m.content_type like 'audio/%'
       and right(p_audio_url, char_length(m.key) + 1) = '/' || m.key
  ) then
    raise exception 'audio_not_uploaded' using errcode = '42501';
  end if;

  select avatar_url into v_avatar from public.profiles where id = v_me;
  if v_cover is not null
     and v_cover is distinct from v_live.thumbnail
     and v_cover is distinct from v_avatar
     and not exists (
       select 1 from public.media_objects m
        where m.user_id = v_me and m.status = 'stored'
          and m.content_type like 'image/%'
          and right(v_cover, char_length(m.key) + 1) = '/' || m.key
     ) then
    raise exception 'cover_not_uploaded' using errcode = '42501';
  end if;

  select count(*) into v_count from public.live_highlights where live_id = p_live_id and kind = 'live';
  if v_count >= 10 then
    raise exception 'highlight_limit_live' using errcode = '23514';
  end if;
  select count(*) into v_count from public.live_highlights
   where host_id = v_me and created_at > now() - interval '1 day';
  if v_count >= 30 then
    raise exception 'highlight_limit_day' using errcode = '23514';
  end if;

  insert into public.live_highlights (kind, live_id, host_id, title, audio_url, cover_url, duration_ms, start_ms)
  values (
    'live', p_live_id, v_me, v_title, p_audio_url,
    coalesce(v_cover, nullif(v_live.thumbnail, ''), nullif(v_avatar, '')),
    p_duration_ms, greatest(coalesce(p_start_ms, 0), 0)
  )
  returning * into v_row;
  return v_row;
end;
$fn$;
revoke all on function public.create_live_highlight(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.create_live_highlight(uuid, text, text, integer, integer, text) to authenticated;

-- ---------- a voice clip (recorded in the app, not from a live) ----------
create or replace function public.create_voice_clip(
  p_audio_url text,
  p_title text,
  p_duration_ms integer,
  p_cover_url text default null
)
returns public.live_highlights
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me     uuid := auth.uid();
  v_avatar text;
  v_cover  text := nullif(btrim(coalesce(p_cover_url, '')), '');
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_count  integer;
  v_row    public.live_highlights;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_duration_ms is null or p_duration_ms < 5000 or p_duration_ms > 301000 then
    raise exception 'bad_duration' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 150 then
    raise exception 'title_too_long' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.media_objects m
     where m.user_id = v_me and m.status = 'stored'
       and m.content_type like 'audio/%'
       and right(p_audio_url, char_length(m.key) + 1) = '/' || m.key
  ) then
    raise exception 'audio_not_uploaded' using errcode = '42501';
  end if;

  select avatar_url into v_avatar from public.profiles where id = v_me;
  if v_cover is not null
     and v_cover is distinct from v_avatar
     and not exists (
       select 1 from public.media_objects m
        where m.user_id = v_me and m.status = 'stored'
          and m.content_type like 'image/%'
          and right(v_cover, char_length(m.key) + 1) = '/' || m.key
     ) then
    raise exception 'cover_not_uploaded' using errcode = '42501';
  end if;

  select count(*) into v_count from public.live_highlights
   where host_id = v_me and created_at > now() - interval '1 day';
  if v_count >= 30 then
    raise exception 'highlight_limit_day' using errcode = '23514';
  end if;

  insert into public.live_highlights (kind, live_id, host_id, title, audio_url, cover_url, duration_ms, start_ms)
  values ('voice', null, v_me, v_title, p_audio_url, coalesce(v_cover, nullif(v_avatar, '')), p_duration_ms, 0)
  returning * into v_row;
  return v_row;
end;
$fn$;
revoke all on function public.create_voice_clip(text, text, integer, text) from public, anon;
grant execute on function public.create_voice_clip(text, text, integer, text) to authenticated;

commit;

-- Checks (SELECT only)
select 'kind column' as check,
       case when exists (select 1 from information_schema.columns where table_name = 'live_highlights' and column_name = 'kind') then 'OK' else 'MISSING' end as result
union all
select 'highlights up to 2 min, voice up to 5 min',
       case when pg_get_constraintdef((select oid from pg_constraint where conname = 'live_highlights_duration_ms_check')) like '%121000%301000%' then 'OK' else 'OLD' end
union all
select '10 per live',
       case when pg_get_functiondef('public.create_live_highlight(uuid,text,text,integer,integer,text)'::regprocedure) like '%v_count >= 10%' then 'OK' else 'OLD' end
union all
select 'voice clip RPC callable',
       case when has_function_privilege('authenticated', 'public.create_voice_clip(text,text,integer,text)', 'execute') then 'OK' else 'MISSING' end;
