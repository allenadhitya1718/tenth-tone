-- 0122 - the remaining "about someone else" helpers answer only for the caller
-- when called directly
--
-- Security review 2026-10, round 2: F15 leftover. Apply after 0121 (needs
-- called_as_rpc from 0112). Safe to re-run.
--
-- 0112 guarded eight helpers. Six more take a viewer / actor id and are
-- callable as RPCs by authenticated (can_see_posts_of by anon too), so
-- POST /rpc/may_message_in_chat {p_chat, p_actor: <someone>} or
-- /rpc/can_view_story {.., p_viewer: <someone>} told you about other people's
-- relationships and settings. RLS policies and SECURITY DEFINER code call
-- them on behalf of the current request, where request.path is that
-- request's own path, so they are unaffected.
--
-- When called directly as an RPC, each now returns false unless the viewer /
-- actor argument is the caller (auth.uid(); for a signed-out caller of
-- can_see_posts_of, a null viewer). Signatures checked against the latest
-- definitions:
--   can_see_posts_of(p_owner uuid, p_viewer uuid)             latest 0049
--   can_view_story(p_owner uuid, p_audience text, p_viewer uuid) latest 0102
--   may_comment_on(p_video uuid, p_actor uuid)                latest 0097
--   may_tag(p_target uuid, p_actor uuid)                      latest 0097
--   may_tag_in_post(p_target uuid, p_owner uuid)              latest 0101
--   may_message_in_chat(p_chat uuid, p_actor uuid)            latest 0069
-- Bodies are verbatim apart from the guard. create or replace keeps grants.

create or replace function public.can_see_posts_of(p_owner uuid, p_viewer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select
    (not public.called_as_rpc('can_see_posts_of') or p_viewer is not distinct from auth.uid())
    and (
      p_owner = p_viewer
      or (
        -- Added (0049): neither direction of a block may see the other's posts.
        -- p_viewer is null for signed-out visitors, where no block can exist.
        (p_viewer is null or not public.is_blocked_between(p_owner, p_viewer))
        and (
          not coalesce((select is_private from public.profiles where id = p_owner), false)
          or exists (select 1 from public.follows
                      where follower_id = p_viewer and followed_id = p_owner)
        )
      )
    );
$fn$;

create or replace function public.can_view_story(
  p_owner    uuid,
  p_audience text,
  p_viewer   uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select p_viewer is not null
     and p_owner is not null
     and (not public.called_as_rpc('can_view_story') or p_viewer = auth.uid())
     and (
       p_owner = p_viewer
       or (
         not public.is_blocked_between(p_owner, p_viewer)
         and not exists (select 1 from public.profiles
                          where id = p_owner and deactivated_at is not null)
         and case p_audience
               when 'everyone' then
                 public.can_see_posts_of(p_owner, p_viewer)
               when 'followers' then
                 exists (select 1 from public.follows
                          where follower_id = p_viewer and followed_id = p_owner)
               when 'close_friends' then
                 exists (select 1 from public.close_friends
                          where user_id = p_owner and friend_id = p_viewer)
               else false
             end
       )
     );
$fn$;

create or replace function public.may_comment_on(p_video uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_owner uuid; v_allow boolean; v_rule text;
begin
  if public.called_as_rpc('may_comment_on') and p_actor is distinct from auth.uid() then
    return false;
  end if;

  select user_id, allow_comments into v_owner, v_allow
    from public.videos where id = p_video;
  if v_owner is null then return false; end if;
  if not coalesce(v_allow, true) then return false; end if;
  if v_owner = p_actor then return true; end if;

  -- Added: a block stops this before any preference is considered.
  if public.is_blocked_between(v_owner, p_actor) then return false; end if;

  v_rule := public.setting_text(v_owner, 'who_can_comment');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = v_owner and followed_id = p_actor);
  end if;
  -- 0097: mutual follows only.
  if v_rule = 'friends' then
    return public.is_friend(v_owner, p_actor);
  end if;
  return true;
end;
$fn$;

create or replace function public.may_tag(p_target uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_rule text;
begin
  if public.called_as_rpc('may_tag') and p_actor is distinct from auth.uid() then
    return false;
  end if;

  if p_target = p_actor then return false; end if;   -- no self-notification

  if exists (select 1 from public.blocks
              where (blocker_id = p_target and blocked_id = p_actor)
                 or (blocker_id = p_actor and blocked_id = p_target)) then
    return false;
  end if;

  if exists (select 1 from public.restricted_users
              where user_id = p_target and restricted_id = p_actor) then
    return false;
  end if;

  v_rule := public.setting_text(p_target, 'who_can_tag');

  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = p_target and followed_id = p_actor);
  end if;
  -- 0097: mutual follows only.
  if v_rule = 'friends' then
    return public.is_friend(p_target, p_actor);
  end if;
  return true;
end;
$fn$;

create or replace function public.may_tag_in_post(p_target uuid, p_owner uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if public.called_as_rpc('may_tag_in_post') and p_owner is distinct from auth.uid() then
    return false;
  end if;

  if p_target is null or p_owner is null or p_target = p_owner then
    return false;
  end if;

  if public.is_blocked_between(p_target, p_owner) then
    return false;
  end if;

  if not public.may_tag(p_target, p_owner) then
    return false;
  end if;

  if public.setting_text(p_target, 'who_can_tag') = 'friends' then
    return exists (select 1 from public.follows
                    where follower_id = p_target and followed_id = p_owner)
       and exists (select 1 from public.follows
                    where follower_id = p_owner and followed_id = p_target);
  end if;

  return true;
end;
$fn$;

create or replace function public.may_message_in_chat(p_chat uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_type text; v_other uuid;
begin
  if public.called_as_rpc('may_message_in_chat') and p_actor is distinct from auth.uid() then
    return false;
  end if;

  select type into v_type from public.chats where id = p_chat;
  if v_type is null then return false; end if;

  -- Groups are unaffected. A per-person "who can message me" rule has no
  -- meaning in a room several people joined; leaving a group is the control
  -- that applies there. (Who may be ADDED to a group is checked by 0116.)
  if v_type <> 'dm' then return true; end if;

  select user_id into v_other
    from public.chat_members
   where chat_id = p_chat and user_id <> p_actor
   limit 1;

  if v_other is null then return true; end if;          -- a chat with only you

  -- Both directions, unchanged from 0049.
  if public.is_blocked_between(v_other, p_actor) then return false; end if;

  return public.may_message(v_other, p_actor);
end;
$fn$;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as check,
       case when pg_get_functiondef(p.oid) like '%called_as_rpc(''' || p.proname || ''')%'
            then 'OK' else 'NOT GUARDED' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_see_posts_of', 'can_view_story', 'may_comment_on',
                     'may_tag', 'may_tag_in_post', 'may_message_in_chat')
union all
select 'can_see_posts_of still callable by anon (videos policy)',
       case when has_function_privilege('anon', 'public.can_see_posts_of(uuid, uuid)', 'execute')
            then 'OK' else 'BROKEN - signed-out browsing fails' end
order by 1;
