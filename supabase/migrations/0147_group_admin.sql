-- 0147 (PROPOSAL, NOT APPLIED) - group admins and the group info screen
--
-- Owner request (real-phone test): tapping a group's name or photo did
-- nothing; a group needs a profile with edit options. The app now has a
-- Group Info screen (mobile/src/features/chat/GroupInfo.tsx). What the
-- database had before this file:
--
--   * chats.name / chats.photo_url (0001): editable only by the creator
--     ("chats update by creator", 0018).
--   * chat_members.role in ('owner', 'member') (0001). No admins.
--   * Adding: "chat_members insert by creator" (0018, 0116) - only the
--     creator, and since 0116 only people who would accept a DM from them.
--   * Removing: "chat_members delete" (0018) - yourself, or anyone by the
--     creator. Leaving as the creator left a group nobody could manage.
--   * No way to delete a group, and no record in the chat of who renamed,
--     added or removed whom.
--
-- This file adds, without changing any RLS policy:
--
--   1. role 'admin' (owner > admin > member). Every group gets exactly one
--      owner: the creator where they are still a member, otherwise the
--      longest-standing member.
--   2. SECURITY DEFINER RPCs, each checking the caller's membership and role:
--        rename_group(chat, name)            admin
--        set_group_photo(chat, url|null)     admin (a group-photos public URL)
--        add_group_members(chat, ids[])      admin; per person: added /
--                                            already_member / blocked /
--                                            not_allowed / not_found
--                                            (blocks + may_message, as 0116)
--        remove_group_member(chat, user)     admin; an admin only by the
--                                            owner; never the owner
--        set_group_admin(chat, user, bool)   admin promotes; owner demotes
--        leave_group(chat)                   anyone; the owner's role (and
--                                            chats.created_by, which the 0018
--                                            policies key on) passes to the
--                                            longest-standing admin, else
--                                            member; the last one out deletes
--                                            the group
--        delete_group(chat)                  owner only
--   3. A 'system' message in the chat for each change. text is JSON, like a
--      call record (0045), so every app shows it in its own language:
--        {"group":"renamed","actor":<uuid>,"actor_name":"..","name":".."}
--        {"group":"photo_changed"|"photo_removed","actor":..,"actor_name":..}
--        {"group":"added","actor":..,"actor_name":..,
--         "targets":[{"id":..,"name":..}, ...]}
--        {"group":"removed"|"admin_added"|"admin_removed","actor":..,
--         "actor_name":..,"target":..,"target_name":..}
--        {"group":"left","actor":..,"actor_name":..}
--        {"group":"owner_changed","actor":<new owner>,"actor_name":..}
--      A system message does not notify or push (a BEFORE INSERT trigger on
--      notifications drops it, so this does not depend on which version of
--      notify_on_message is live), and the app can no longer write one
--      itself (they were never written by an app; now they cannot be forged).
--      Writing it never fails the change: past the message rate limit (0050)
--      the change happens without its line.
--
-- RLS is unchanged. Older apps keep working: the creator-only policies still
-- apply to them, and the creator is (or becomes) the owner.
--
-- Needs 0018, 0049, 0097 (may_message), 0116. Safe to re-run.

begin;

-- ── 1. Roles ────────────────────────────────────────────────────────────
-- The 0001 inline check is named chat_members_role_check.
alter table public.chat_members drop constraint if exists chat_members_role_check;
alter table public.chat_members
  add constraint chat_members_role_check check (role in ('owner', 'admin', 'member'));

-- The creator, still a member, of a group with no owner, becomes its owner.
update public.chat_members cm
   set role = 'owner'
  from public.chats c
 where c.id = cm.chat_id
   and c.type = 'group'
   and cm.user_id = c.created_by
   and cm.role <> 'owner'
   and not exists (select 1 from public.chat_members o
                    where o.chat_id = cm.chat_id and o.role = 'owner');

-- A group still without an owner (its creator left): the longest-standing
-- member takes over, and chats.created_by follows so the 0018 policies
-- (creator-only update/insert/delete) point at someone who is there.
with heirs as (
  select distinct on (cm.chat_id) cm.chat_id, cm.user_id
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id and c.type = 'group'
   where not exists (select 1 from public.chat_members o
                      where o.chat_id = cm.chat_id and o.role = 'owner')
   order by cm.chat_id, (cm.role = 'admin') desc, cm.joined_at, cm.user_id
)
update public.chat_members cm
   set role = 'owner'
  from heirs h
 where cm.chat_id = h.chat_id and cm.user_id = h.user_id;

update public.chats c
   set created_by = cm.user_id
  from public.chat_members cm
 where cm.chat_id = c.id
   and cm.role = 'owner'
   and c.type = 'group'
   and c.created_by is distinct from cm.user_id;

-- ── 2. Helpers (internal: not callable from the app) ────────────────────

-- The caller's role in a group, or an exception the app turns into a
-- message: not_signed_in, group_not_found (no such group, or not a group),
-- not_member, not_admin.
create or replace function public.group_caller_role(p_chat_id uuid, p_need_admin boolean)
returns text
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_me   uuid := auth.uid();
  v_role text;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.chats where id = p_chat_id and type = 'group') then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  select role into v_role from public.chat_members
   where chat_id = p_chat_id and user_id = v_me;
  if v_role is null then
    raise exception 'not_member' using errcode = '42501';
  end if;
  if p_need_admin and v_role not in ('owner', 'admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return v_role;
end;
$fn$;
revoke all on function public.group_caller_role(uuid, boolean) from public, anon, authenticated;

create or replace function public.group_display_name(p_user uuid)
returns text
language sql
security definer
stable
set search_path = public
as $fn$
  select coalesce(nullif(btrim(p.name), ''), nullif(p.handle, ''), '')
    from public.profiles p where p.id = p_user;
$fn$;
revoke all on function public.group_display_name(uuid) from public, anon, authenticated;

-- One line in the chat. Never fails the change it records.
create or replace function public.group_system_message(p_chat_id uuid, p_actor uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  begin
    insert into public.messages (chat_id, from_user_id, type, text)
    values (p_chat_id, p_actor, 'system',
            (jsonb_build_object('actor', p_actor,
                                'actor_name', coalesce(public.group_display_name(p_actor), ''))
             || p_payload)::text);
  exception when others then
    raise warning 'group_system_message skipped: %', sqlerrm;
  end;
end;
$fn$;
revoke all on function public.group_system_message(uuid, uuid, jsonb) from public, anon, authenticated;

-- ── 3. System messages: written only by the server, never pushed ───────

-- SECURITY INVOKER: current_user is the role that issued the INSERT. The
-- RPCs above run as their definer, so only a direct insert from the app is
-- refused.
create or replace function public.guard_system_messages()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.type = 'system' and current_user in ('authenticated', 'anon') then
    raise exception 'system messages are written by the server'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_system_messages() from public, anon, authenticated;

drop trigger if exists tr_guard_system_messages on public.messages;
create trigger tr_guard_system_messages
  before insert on public.messages
  for each row execute function public.guard_system_messages();

-- "Allen renamed the group" is not worth a push. Dropped at the
-- notifications table so it holds whatever notify_on_message is live
-- (0116, 0144, 0146 each restate it).
create or replace function public.skip_system_message_notifications()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  return null;
end;
$fn$;
revoke all on function public.skip_system_message_notifications() from public, anon, authenticated;

drop trigger if exists tr_skip_system_message_notifications on public.notifications;
create trigger tr_skip_system_message_notifications
  before insert on public.notifications
  for each row
  when (new.type = 'message' and (new.payload ->> 'kind') = 'system')
  execute function public.skip_system_message_notifications();

-- ── 4. The RPCs ─────────────────────────────────────────────────────────

-- Rename. 1-60 characters after trimming (the app's MAX_NAME).
create or replace function public.rename_group(p_chat_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_old  text;
begin
  perform public.group_caller_role(p_chat_id, true);
  if v_name = '' then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  select name into v_old from public.chats where id = p_chat_id;
  if v_old is not distinct from v_name then
    return;
  end if;
  update public.chats set name = v_name where id = p_chat_id;
  perform public.group_system_message(p_chat_id, auth.uid(),
    jsonb_build_object('group', 'renamed', 'name', v_name));
end;
$fn$;
revoke all on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;

-- Photo. The app uploads to the public group-photos bucket (as createGroup
-- does) and passes the public URL; null removes the photo.
create or replace function public.set_group_photo(p_chat_id uuid, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_url text := nullif(btrim(coalesce(p_photo_url, '')), '');
  v_old text;
begin
  perform public.group_caller_role(p_chat_id, true);
  if v_url is not null
     and (v_url !~ '^https://[^\s]+/storage/v1/object/public/group-photos/[^\s]+$'
          or char_length(v_url) > 1000) then
    raise exception 'bad_photo_url' using errcode = '22023';
  end if;
  select photo_url into v_old from public.chats where id = p_chat_id;
  if v_old is not distinct from v_url then
    return;
  end if;
  update public.chats set photo_url = v_url where id = p_chat_id;
  perform public.group_system_message(p_chat_id, auth.uid(),
    jsonb_build_object('group', case when v_url is null then 'photo_removed' else 'photo_changed' end));
end;
$fn$;
revoke all on function public.set_group_photo(uuid, text) from public, anon;
grant execute on function public.set_group_photo(uuid, text) to authenticated;

-- Add people. The same rules as the 0116 insert policy, one person at a
-- time, so one person who cannot be added does not stop the rest, and the
-- app can say why for each one. At most 50 per call and 256 in a group.
create or replace function public.add_group_members(p_chat_id uuid, p_user_ids uuid[])
returns table (user_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me      uuid := auth.uid();
  v_id      uuid;
  v_count   integer;
  v_added   jsonb := '[]'::jsonb;
  v_status  text;
begin
  perform public.group_caller_role(p_chat_id, true);
  if coalesce(array_length(p_user_ids, 1), 0) > 50 then
    raise exception 'too_many' using errcode = '22023';
  end if;
  select count(*) into v_count from public.chat_members cm where cm.chat_id = p_chat_id;

  for v_id in select distinct u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u where u is not null loop
    if exists (select 1 from public.chat_members cm where cm.chat_id = p_chat_id and cm.user_id = v_id) then
      v_status := 'already_member';
    elsif not exists (select 1 from public.profiles p where p.id = v_id) then
      v_status := 'not_found';
    elsif public.is_blocked_between(v_id, v_me) then
      v_status := 'blocked';
    elsif not public.may_message(v_id, v_me) then
      v_status := 'not_allowed';
    elsif v_count >= 256 then
      v_status := 'group_full';
    else
      insert into public.chat_members (chat_id, user_id, role)
      values (p_chat_id, v_id, 'member')
      on conflict do nothing;
      v_count := v_count + 1;
      v_status := 'added';
      v_added := v_added || jsonb_build_array(
        jsonb_build_object('id', v_id, 'name', coalesce(public.group_display_name(v_id), '')));
    end if;
    user_id := v_id;
    status := v_status;
    return next;
  end loop;

  if jsonb_array_length(v_added) > 0 then
    perform public.group_system_message(p_chat_id, v_me,
      jsonb_build_object('group', 'added', 'targets', v_added));
  end if;
end;
$fn$;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

-- Remove someone. Admins remove members; only the owner removes an admin;
-- nobody removes the owner. Removing yourself is leave_group.
create or replace function public.remove_group_member(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me     uuid := auth.uid();
  v_mine   text;
  v_theirs text;
begin
  v_mine := public.group_caller_role(p_chat_id, true);
  if p_user_id = v_me then
    raise exception 'use_leave' using errcode = '22023';
  end if;
  select role into v_theirs from public.chat_members
   where chat_id = p_chat_id and user_id = p_user_id;
  if v_theirs is null then
    raise exception 'target_not_member' using errcode = 'P0002';
  end if;
  if v_theirs = 'owner' then
    raise exception 'owner_protected' using errcode = '42501';
  end if;
  if v_theirs = 'admin' and v_mine <> 'owner' then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  delete from public.chat_members where chat_id = p_chat_id and user_id = p_user_id;
  perform public.group_system_message(p_chat_id, v_me,
    jsonb_build_object('group', 'removed', 'target', p_user_id,
                       'target_name', coalesce(public.group_display_name(p_user_id), '')));
end;
$fn$;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- Make or unmake an admin. Any admin makes one; only the owner unmakes one.
-- The owner's own role never changes here.
create or replace function public.set_group_admin(p_chat_id uuid, p_user_id uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me     uuid := auth.uid();
  v_mine   text;
  v_theirs text;
  v_new    text := case when p_admin then 'admin' else 'member' end;
begin
  v_mine := public.group_caller_role(p_chat_id, true);
  select role into v_theirs from public.chat_members
   where chat_id = p_chat_id and user_id = p_user_id;
  if v_theirs is null then
    raise exception 'target_not_member' using errcode = 'P0002';
  end if;
  if v_theirs = 'owner' then
    raise exception 'owner_protected' using errcode = '42501';
  end if;
  if not p_admin and v_mine <> 'owner' and p_user_id <> v_me then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if v_theirs = v_new then
    return;
  end if;
  update public.chat_members set role = v_new
   where chat_id = p_chat_id and user_id = p_user_id;
  perform public.group_system_message(p_chat_id, v_me,
    jsonb_build_object('group', case when p_admin then 'admin_added' else 'admin_removed' end,
                       'target', p_user_id,
                       'target_name', coalesce(public.group_display_name(p_user_id), '')));
end;
$fn$;
revoke all on function public.set_group_admin(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_group_admin(uuid, uuid, boolean) to authenticated;

-- Leave. Returns {"deleted": bool, "new_owner": uuid|null}.
--   * Last one out: the group is deleted (nobody could ever see it again).
--   * The owner leaving: the longest-standing admin becomes owner, or else
--     the longest-standing member; chats.created_by follows.
create or replace function public.leave_group(p_chat_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := auth.uid();
  v_mine  text;
  v_heir  uuid;
begin
  v_mine := public.group_caller_role(p_chat_id, false);

  if not exists (select 1 from public.chat_members
                  where chat_id = p_chat_id and user_id <> v_me) then
    delete from public.chats where id = p_chat_id;
    return jsonb_build_object('deleted', true, 'new_owner', null);
  end if;

  perform public.group_system_message(p_chat_id, v_me, jsonb_build_object('group', 'left'));

  if v_mine = 'owner' then
    select cm.user_id into v_heir
      from public.chat_members cm
     where cm.chat_id = p_chat_id and cm.user_id <> v_me
     order by (cm.role = 'admin') desc, cm.joined_at, cm.user_id
     limit 1;
    update public.chat_members set role = 'owner'
     where chat_id = p_chat_id and user_id = v_heir;
    perform public.group_system_message(p_chat_id, v_heir,
      jsonb_build_object('group', 'owner_changed'));
  end if;

  delete from public.chat_members where chat_id = p_chat_id and user_id = v_me;

  -- The 0018 policies key on created_by; keep it on the current owner.
  update public.chats c
     set created_by = (select cm.user_id from public.chat_members cm
                        where cm.chat_id = p_chat_id and cm.role = 'owner' limit 1)
   where c.id = p_chat_id
     and c.created_by is not distinct from v_me;

  return jsonb_build_object('deleted', false, 'new_owner', v_heir);
end;
$fn$;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

-- Delete the group for everyone: owner only. Messages and memberships go
-- with it (on delete cascade); call records keep their row (set null).
create or replace function public.delete_group(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.group_caller_role(p_chat_id, true) <> 'owner' then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  delete from public.chats where id = p_chat_id and type = 'group';
end;
$fn$;
revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'chat_members accepts role admin' as check,
       case when pg_get_constraintdef((select oid from pg_constraint
                                        where conrelid = 'public.chat_members'::regclass
                                          and conname = 'chat_members_role_check')) like '%admin%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'every group has exactly one owner',
       case when not exists (
              select 1 from public.chats c
               where c.type = 'group'
                 and exists (select 1 from public.chat_members m where m.chat_id = c.id)
                 and (select count(*) from public.chat_members m
                       where m.chat_id = c.id and m.role = 'owner') <> 1)
            then 'OK' else 'SOME GROUPS WITHOUT ONE OWNER' end
union all
select 'system messages cannot be forged',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.messages'::regclass
                            and tgname = 'tr_guard_system_messages' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'system messages do not push',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.notifications'::regclass
                            and tgname = 'tr_skip_system_message_notifications' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'group RPCs callable by the app',
       case when has_function_privilege('authenticated', 'public.rename_group(uuid, text)', 'execute')
             and has_function_privilege('authenticated', 'public.set_group_photo(uuid, text)', 'execute')
             and has_function_privilege('authenticated', 'public.add_group_members(uuid, uuid[])', 'execute')
             and has_function_privilege('authenticated', 'public.remove_group_member(uuid, uuid)', 'execute')
             and has_function_privilege('authenticated', 'public.set_group_admin(uuid, uuid, boolean)', 'execute')
             and has_function_privilege('authenticated', 'public.leave_group(uuid)', 'execute')
             and has_function_privilege('authenticated', 'public.delete_group(uuid)', 'execute')
            then 'OK' else 'NOT GRANTED' end
union all
select 'group RPCs not callable signed out',
       case when not has_function_privilege('anon', 'public.rename_group(uuid, text)', 'execute')
             and not has_function_privilege('anon', 'public.leave_group(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.delete_group(uuid)', 'execute')
            then 'OK' else 'EXPOSED' end
union all
select 'helpers are internal',
       case when not has_function_privilege('authenticated', 'public.group_caller_role(uuid, boolean)', 'execute')
             and not has_function_privilege('authenticated', 'public.group_system_message(uuid, uuid, jsonb)', 'execute')
            then 'OK' else 'EXPOSED' end
order by 1;

-- Behavioural test: group G created by A with B and C; D has blocked A;
-- E has "who can message me: nobody".
--   as B: select rename_group('<G>', 'x');          -- not_admin
--   as A: select set_group_admin('<G>', '<B>', true);
--   as B: select rename_group('<G>', 'Trip');       -- ok, a 'renamed' line
--   as B: select * from add_group_members('<G>', array['<D>','<E>','<C>']::uuid[]);
--         -- D blocked, E not_allowed, C already_member
--   as B: select remove_group_member('<G>', '<A>'); -- owner_protected
--   as B: select delete_group('<G>');               -- owner_only
--   as A: select leave_group('<G>');                -- B becomes owner
--   as B: insert into messages (chat_id, from_user_id, type, text)
--         values ('<G>', '<B>', 'system', '{}');    -- refused
