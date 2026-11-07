-- 0169: every live highlight has a picture (owner, 7 Nov 2026: "the
-- highlight should have a cover image with the audio, not just an audio mp3").
--
-- 1. create_live_highlight takes an optional p_cover_url: a photo the host
--    chose on the trim screen. It must be an image this person uploaded
--    (media_objects, stored), or the live's own cover, or their own profile
--    photo. Without one, the cover is the live's cover, else the host's
--    profile photo (it used to be the live's cover or nothing).
--    The 5-argument version is replaced by a 6-argument one whose last
--    argument defaults to null, so app versions that send 5 still work.
-- 2. Deleting a highlight also queues its cover. The delete worker skips
--    anything still in use (media_key_referenced), so a live cover or a
--    profile photo used as the cover is never removed.
-- 3. Existing highlights without a cover get the host's profile photo.
--    (A host with no photo gets the app's branded cover: FLYP waveform on
--    navy with their name, drawn by the app.)
--
-- Safe to re-run.

begin;

drop function if exists public.create_live_highlight(uuid, text, text, integer, integer);

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

  select avatar_url into v_avatar from public.profiles where id = v_me;

  -- A chosen cover: an image this person uploaded, or the live's cover, or
  -- their own profile photo. Nothing else (no pointing at other files).
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
  values (
    p_live_id, v_me, v_title, p_audio_url,
    coalesce(v_cover, nullif(v_live.thumbnail, ''), nullif(v_avatar, '')),
    p_duration_ms, greatest(coalesce(p_start_ms, 0), 0)
  )
  returning * into v_row;
  return v_row;
end;
$fn$;
revoke all on function public.create_live_highlight(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.create_live_highlight(uuid, text, text, integer, integer, text) to authenticated;

-- The cover goes with the highlight too (skipped by the worker while the
-- same file is still a live cover or a profile photo).
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
  if coalesce(old.cover_url, '') <> '' then
    insert into public.media_delete_queue (url, source)
    values (old.cover_url, 'live_highlights')
    on conflict (url) do nothing;
  end if;
  return null;
end;
$fn$;
revoke all on function public.queue_highlight_media() from public, anon, authenticated;

-- Existing highlights without a picture: the host's profile photo.
update public.live_highlights h
   set cover_url = p.avatar_url
  from public.profiles p
 where p.id = h.host_id
   and coalesce(h.cover_url, '') = ''
   and coalesce(p.avatar_url, '') <> '';

commit;

-- Checks (SELECT only)
select 'create RPC takes a cover' as check,
       case when has_function_privilege('authenticated', 'public.create_live_highlight(uuid,text,text,integer,integer,text)', 'execute') then 'OK' else 'MISSING' end as result
union all
select 'old 5-argument version gone',
       case when to_regprocedure('public.create_live_highlight(uuid,text,text,integer,integer)') is null then 'OK' else 'STILL THERE' end
union all
select 'delete queues the cover',
       case when pg_get_functiondef('public.queue_highlight_media()'::regprocedure) like '%old.cover_url%' then 'OK' else 'MISSING' end
union all
select 'highlights without any picture (host has no photo either)',
       (select count(*)::text from public.live_highlights where coalesce(cover_url, '') = '');
