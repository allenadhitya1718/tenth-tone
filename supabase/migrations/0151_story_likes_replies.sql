-- 0151 - Like and reply to a story (owner request, as on Instagram)
--
--   Like:  a heart on someone else's story. Stored on the viewer's own view
--          row (story_views.liked_at), so a like needs the story to be
--          visible to you exactly as a view does. The owner sees a heart next
--          to that person in "Seen by"; the viewer sees their heart filled.
--   Reply: a message to the story's owner, in your DM with them, showing a
--          small picture of the story above your text (messages.type
--          'story_reply'). The picture is taken from the story by the server,
--          never from the app, so a reply cannot carry someone else's link.
--          It goes through the normal message path afterwards: realtime, the
--          message notification, rate limits.
--
-- Changes:
--   * story_views.liked_at; viewers may set it (and only it) on their own
--     row, through like_story; the time is the server's.
--   * fetch_user_stories + "liked", fetch_story_viewers + "liked" (both
--     re-created: a returned column cannot be added in place; same security,
--     same filters).
--   * messages.type gains 'story_reply' (the 0146 list plus it).
--   * reply_to_story(story, chat, text): SECURITY DEFINER; you must have
--     seen the story (your view row, which only exists for a story you could
--     see), it must still be live and not yours, the chat must be the DM
--     between you and its owner, and there must be no block.
--
-- Needs 0102, 0146, 0054 (is_blocked_between). Safe to re-run.

begin;

-- ── 1. Likes ────────────────────────────────────────────────────────────

alter table public.story_views add column if not exists liked_at timestamptz;

drop policy if exists "story_views update own" on public.story_views;
create policy "story_views update own" on public.story_views
  for update to authenticated
  using (viewer_id = (select auth.uid()))
  with check (viewer_id = (select auth.uid()));

-- Only the like column, never the view itself.
revoke update on public.story_views from authenticated;
grant update (liked_at) on public.story_views to authenticated;

-- The like's time is the server's, and the view row's other columns never
-- change on an update.
create or replace function public.story_views_before_update()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.story_id  := old.story_id;
  new.viewer_id := old.viewer_id;
  new.viewed_at := old.viewed_at;
  if new.liked_at is not null then
    new.liked_at := coalesce(old.liked_at, now());
  end if;
  return new;
end;
$fn$;
revoke all on function public.story_views_before_update() from public, anon, authenticated;

drop trigger if exists tr_story_views_before_update on public.story_views;
create trigger tr_story_views_before_update
  before update on public.story_views
  for each row execute function public.story_views_before_update();

-- Like or unlike. SECURITY INVOKER: records the view first under your own
-- policies (so only a story you can see), then sets the like on your row.
-- Returns whether the story is now liked by you; false when you cannot see
-- it (or it is your own).
create or replace function public.like_story(p_story_id uuid, p_liked boolean)
returns boolean
language plpgsql
set search_path = public
as $fn$
declare v_liked timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  perform public.mark_story_viewed(p_story_id);
  update public.story_views
     set liked_at = case when coalesce(p_liked, false) then now() else null end
   where story_id = p_story_id and viewer_id = auth.uid()
  returning liked_at into v_liked;
  return v_liked is not null;
end;
$fn$;
revoke all on function public.like_story(uuid, boolean) from public, anon;
grant execute on function public.like_story(uuid, boolean) to authenticated;

-- 0102's function plus "liked" (yours, on someone else's story).
drop function if exists public.fetch_user_stories(uuid);
create function public.fetch_user_stories(p_user_id uuid)
returns table (
  id              uuid,
  user_id         uuid,
  media_url       text,
  media_kind      text,
  poster_url      text,
  sound_id        uuid,
  sound_title     text,
  sound_author    text,
  sound_audio_url text,
  sound_start_ms  integer,
  caption         text,
  audience        text,
  created_at      timestamptz,
  expires_at      timestamptz,
  seen            boolean,
  view_count      integer,
  liked           boolean
)
language sql
stable
set search_path = public
as $fn$
  select s.id, s.user_id, s.media_url, s.media_kind, s.poster_url,
         s.sound_id, snd.title, snd.author_name, snd.audio_url, s.sound_start_ms,
         s.caption, s.audience, s.created_at, s.expires_at,
         (s.user_id = (select auth.uid())
          or exists (select 1 from public.story_views sv
                      where sv.story_id = s.id
                        and sv.viewer_id = (select auth.uid()))) as seen,
         case when s.user_id = (select auth.uid())
              then (select count(*)::integer from public.story_views sv
                     where sv.story_id = s.id)
         end as view_count,
         exists (select 1 from public.story_views sv
                  where sv.story_id = s.id
                    and sv.viewer_id = (select auth.uid())
                    and sv.liked_at is not null) as liked
    from public.stories s
    left join public.sounds snd on snd.id = s.sound_id
   where s.user_id = p_user_id
     and s.expires_at > now()
   order by s.created_at asc;
$fn$;
revoke all on function public.fetch_user_stories(uuid) from public, anon;
grant execute on function public.fetch_user_stories(uuid) to authenticated;

-- 0102's function plus "liked" (the viewer liked it).
drop function if exists public.fetch_story_viewers(uuid, integer, integer);
create function public.fetch_story_viewers(
  p_story_id uuid,
  p_limit    integer default 200,
  p_offset   integer default 0
)
returns table (
  viewer_id  uuid,
  handle     text,
  name       text,
  avatar_url text,
  verified   boolean,
  viewed_at  timestamptz,
  liked      boolean
)
language sql
stable
set search_path = public
as $fn$
  select sv.viewer_id, p.handle, p.name, p.avatar_url, p.verified, sv.viewed_at,
         sv.liked_at is not null as liked
    from public.story_views sv
    join public.stories s  on s.id = sv.story_id
    join public.profiles p on p.id = sv.viewer_id
   where sv.story_id = p_story_id
     and s.user_id = (select auth.uid())
     and not public.is_blocked_between(s.user_id, sv.viewer_id)
   order by sv.viewed_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;
revoke all on function public.fetch_story_viewers(uuid, integer, integer) from public, anon;
grant execute on function public.fetch_story_viewers(uuid, integer, integer) to authenticated;

-- ── 2. Replies ──────────────────────────────────────────────────────────

alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system',
                  'file', 'location', 'call', 'gif', 'video_share', 'story_reply'));

create or replace function public.reply_to_story(p_story_id uuid, p_chat_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := auth.uid();
  v_text  text := btrim(coalesce(p_text, ''));
  v_story record;
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'empty_reply' using errcode = '22023';
  end if;
  if char_length(v_text) > 1000 then
    raise exception 'reply_too_long' using errcode = '22023';
  end if;

  select s.id, s.user_id, s.media_kind, s.media_url, s.poster_url
    into v_story
    from public.stories s
   where s.id = p_story_id and s.expires_at > now();
  if v_story.id is null then
    raise exception 'story_gone' using errcode = 'P0002';
  end if;
  if v_story.user_id = v_me then
    raise exception 'own_story' using errcode = '22023';
  end if;
  -- Only a story you have actually been shown (the view row exists only
  -- for a story you could see when you opened it).
  if not exists (select 1 from public.story_views
                  where story_id = p_story_id and viewer_id = v_me) then
    raise exception 'story_gone' using errcode = 'P0002';
  end if;
  if public.is_blocked_between(v_story.user_id, v_me) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  -- The DM between exactly you and the story's owner.
  if not exists (select 1 from public.chats c
                  where c.id = p_chat_id and c.type <> 'group')
     or (select count(*) from public.chat_members m where m.chat_id = p_chat_id) <> 2
     or not exists (select 1 from public.chat_members m where m.chat_id = p_chat_id and m.user_id = v_me)
     or not exists (select 1 from public.chat_members m where m.chat_id = p_chat_id and m.user_id = v_story.user_id) then
    raise exception 'bad_chat' using errcode = '22023';
  end if;

  insert into public.messages (chat_id, from_user_id, type, text, attachment_url)
  values (p_chat_id, v_me, 'story_reply', v_text,
          coalesce(v_story.poster_url, case when v_story.media_kind = 'image' then v_story.media_url end))
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.reply_to_story(uuid, uuid, text) from public, anon;
grant execute on function public.reply_to_story(uuid, uuid, text) to authenticated;

-- A story reply is written only by reply_to_story, so its picture is always
-- the story's own. SECURITY INVOKER: current_user is the role that issued
-- the INSERT; the function above runs as its owner.
create or replace function public.guard_story_replies()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.type = 'story_reply' and current_user in ('authenticated', 'anon') then
    raise exception 'story replies are sent through reply_to_story'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_story_replies() from public, anon, authenticated;

drop trigger if exists tr_guard_story_replies on public.messages;
create trigger tr_guard_story_replies
  before insert on public.messages
  for each row execute function public.guard_story_replies();

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'story_views.liked_at exists' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'story_views' and column_name = 'liked_at')
            then 'OK' else 'MISSING' end as result
union all
select 'viewers may change only the like column',
       case when has_column_privilege('authenticated', 'public.story_views', 'liked_at', 'UPDATE')
             and not has_column_privilege('authenticated', 'public.story_views', 'viewed_at', 'UPDATE')
            then 'OK' else 'WRONG' end
union all
select 'story lists say liked',
       case when pg_get_function_result('public.fetch_user_stories(uuid)'::regprocedure) like '%liked%'
             and pg_get_function_result('public.fetch_story_viewers(uuid, integer, integer)'::regprocedure) like '%liked%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'messages accept story_reply',
       case when pg_get_constraintdef((select oid from pg_constraint
                                        where conrelid = 'public.messages'::regclass
                                          and conname = 'messages_type_check')) like '%story_reply%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'story replies cannot be forged by the app',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.messages'::regclass
                            and tgname = 'tr_guard_story_replies' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'like_story / reply_to_story callable by the app only',
       case when has_function_privilege('authenticated', 'public.like_story(uuid, boolean)', 'execute')
             and has_function_privilege('authenticated', 'public.reply_to_story(uuid, uuid, text)', 'execute')
             and not has_function_privilege('anon', 'public.reply_to_story(uuid, uuid, text)', 'execute')
            then 'OK' else 'WRONG' end
order by 1;
