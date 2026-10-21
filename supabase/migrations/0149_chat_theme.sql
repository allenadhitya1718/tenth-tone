-- 0149 - Chat themes (client: a choice of chat backgrounds, like Instagram)
--
-- A chat's background is now chosen by its members and shared: when anyone
-- in the chat picks a theme, everyone in it sees it, and a line appears in
-- the chat ("Allen changed the chat theme"), as on Instagram.
--
--   chats.theme          null = the default doodle; otherwise a key from the
--                        app's catalogue ('solid:sand', 'gradient:sunset',
--                        'photo'). The server checks the shape only, so new
--                        themes need no migration; an app that does not know
--                        a key draws the default.
--   chats.wallpaper_url  set only with theme 'photo': a public group-photos
--                        URL the app uploaded (same bucket and rule as a
--                        group photo, 0147).
--
--   set_chat_theme(chat, theme, wallpaper_url)  SECURITY DEFINER:
--     * any member of the chat (DM or group);
--     * in a DM, not while it is still an unanswered message request from
--       the caller (the other person has not accepted, does not follow the
--       caller and has never written), and not across a block, so a stranger
--       cannot push a photo into someone's chat;
--     * writes a 'system' line {"group":"theme_changed",...} through 0147's
--       group_system_message (never pushed, cannot be forged by the app).
--
-- The new URL column is added to media_key_referenced (0138) so the media
-- sweeper counts a wallpaper as in use.
--
-- RLS unchanged: members already read their chats row. A trigger stops the
-- app writing the two columns directly (the 0018 creator-only update policy
-- would otherwise let whoever started a DM skip the request check).
--
-- Needs 0001, 0018, 0054 (is_blocked_between), 0138, 0147. Safe to re-run.

begin;

alter table public.chats add column if not exists theme text;
alter table public.chats add column if not exists wallpaper_url text;

alter table public.chats drop constraint if exists chats_theme_check;
alter table public.chats
  add constraint chats_theme_check
  check (theme is null or theme ~ '^[a-z0-9_-]{1,24}(:[a-z0-9_-]{1,24})?$');

alter table public.chats drop constraint if exists chats_wallpaper_url_check;
alter table public.chats
  add constraint chats_wallpaper_url_check
  check (wallpaper_url is null
         or (theme = 'photo'
             and char_length(wallpaper_url) <= 1000
             and wallpaper_url ~ '^https://[^[:space:]]+/storage/v1/object/public/group-photos/[^[:space:]]+$'));

create or replace function public.set_chat_theme(p_chat_id uuid, p_theme text, p_wallpaper_url text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := auth.uid();
  v_type  text;
  v_theme text := nullif(btrim(coalesce(p_theme, '')), '');
  v_url   text := nullif(btrim(coalesce(p_wallpaper_url, '')), '');
  v_old   record;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select type into v_type from public.chats where id = p_chat_id;
  if v_type is null then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.chat_members
                  where chat_id = p_chat_id and user_id = v_me) then
    raise exception 'not_member' using errcode = '42501';
  end if;

  if v_type <> 'group' then
    if exists (select 1 from public.chat_members o
                where o.chat_id = p_chat_id and o.user_id <> v_me
                  and public.is_blocked_between(o.user_id, v_me)) then
      raise exception 'blocked' using errcode = '42501';
    end if;
    -- Still a request from me: they have not accepted, do not follow me,
    -- and have not written here.
    if exists (select 1 from public.chat_members o
                where o.chat_id = p_chat_id and o.user_id <> v_me
                  and o.accepted_at is null
                  and not exists (select 1 from public.follows f
                                   where f.follower_id = o.user_id and f.followed_id = v_me)
                  and not exists (select 1 from public.messages m
                                   where m.chat_id = p_chat_id and m.from_user_id = o.user_id)) then
      raise exception 'not_accepted' using errcode = '42501';
    end if;
  end if;

  if v_theme is not null and v_theme !~ '^[a-z0-9_-]{1,24}(:[a-z0-9_-]{1,24})?$' then
    raise exception 'bad_theme' using errcode = '22023';
  end if;
  if v_theme = 'photo' then
    if v_url is null
       or v_url !~ '^https://[^[:space:]]+/storage/v1/object/public/group-photos/[^[:space:]]+$'
       or char_length(v_url) > 1000 then
      raise exception 'bad_wallpaper_url' using errcode = '22023';
    end if;
  else
    v_url := null;
  end if;

  select theme, wallpaper_url into v_old from public.chats where id = p_chat_id;
  if v_old.theme is not distinct from v_theme and v_old.wallpaper_url is not distinct from v_url then
    return;
  end if;

  update public.chats set theme = v_theme, wallpaper_url = v_url where id = p_chat_id;
  perform public.group_system_message(p_chat_id, v_me,
    jsonb_build_object('group', 'theme_changed', 'theme', coalesce(v_theme, 'default')));
end;
$fn$;
revoke all on function public.set_chat_theme(uuid, text, text) from public, anon;
grant execute on function public.set_chat_theme(uuid, text, text) to authenticated;

-- The 0018 policy lets a chat's creator update the row directly, and the
-- creator of a DM is whoever wrote first: a stranger. So the two theme
-- columns change only through set_chat_theme. SECURITY INVOKER: current_user
-- is the role that issued the UPDATE; the function above runs as its owner.
create or replace function public.guard_chat_theme()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user in ('authenticated', 'anon')
     and (new.theme is distinct from old.theme or new.wallpaper_url is distinct from old.wallpaper_url) then
    raise exception 'chat themes are changed through set_chat_theme'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_chat_theme() from public, anon, authenticated;

drop trigger if exists tr_guard_chat_theme on public.chats;
create trigger tr_guard_chat_theme
  before update on public.chats
  for each row execute function public.guard_chat_theme();

-- 0138's list plus chats.wallpaper_url.
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


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'chats.theme and chats.wallpaper_url exist' as check,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'chats'
                     and column_name in ('theme', 'wallpaper_url')) = 2
            then 'OK' else 'MISSING' end as result
union all
select 'theme keys checked',
       case when 'solid:sand' ~ '^[a-z0-9_-]{1,24}(:[a-z0-9_-]{1,24})?$'
             and 'photo' ~ '^[a-z0-9_-]{1,24}(:[a-z0-9_-]{1,24})?$'
             and not ('<script>' ~ '^[a-z0-9_-]{1,24}(:[a-z0-9_-]{1,24})?$')
             and not ('a:b:c' ~ '^[a-z0-9_-]{1,24}(:[a-z0-9_-]{1,24})?$')
            then 'OK' else 'WRONG' end
union all
select 'set_chat_theme callable by the app, not signed out',
       case when has_function_privilege('authenticated', 'public.set_chat_theme(uuid, text, text)', 'execute')
             and not has_function_privilege('anon', 'public.set_chat_theme(uuid, text, text)', 'execute')
            then 'OK' else 'WRONG' end
union all
select 'theme columns cannot be written directly by the app',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.chats'::regclass
                            and tgname = 'tr_guard_chat_theme' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'media sweeper counts wallpapers as in use',
       case when pg_get_functiondef('public.media_key_referenced(text)'::regprocedure) like '%wallpaper_url%'
            then 'OK' else 'NOT UPDATED' end
order by 1;
