-- 0116 - groups: nobody is added who could not have been messaged
--
-- Security review 2026-10, finding F05 (high). Apply after 0115. Safe to
-- re-run.
--
-- ============================================================
-- F05 - A GROUP WAS A WAY ROUND EVERY MESSAGING RULE
-- ============================================================
-- "chat_members insert by creator" (0018) is
--     with check (public.is_chat_creator(chat_id))
-- so the creator of a chat could add ANY user id to it. may_message_in_chat()
-- (0069) applies "who can message me", the restrict list and blocks only to
-- chats of type 'dm' - groups pass unconditionally - and notify_on_message
-- (0093) pushes to every member. So someone you had blocked, restricted, or
-- shut out with "who can message me: nobody" could create a group, add you,
-- and message (and push-notify) you as much as the rate limit allowed.
--
-- Two more ways in through the same door:
--   * add a third person to a 'dm' chat: may_message_in_chat() checks only
--     ONE other member (limit 1), so the rest of the "DM" was unchecked;
--   * create a DM with open_or_create_dm() and flip chats.type to 'group'
--     ("chats update by creator" allows any column), and the DM rules stop
--     applying.
--
-- Fixes:
--   * A chat's creator may add themselves to any chat they created, and other
--     people only to a GROUP, and only people who would accept a DM from them
--     (may_message: block, restrict, "who can message me") and who have not
--     blocked them / been blocked by them. Added as 'member' only.
--     DMs get their two members from open_or_create_dm() (SECURITY DEFINER),
--     which is unaffected.
--   * The app may create only groups ('dm' chats come from
--     open_or_create_dm), and may not change a chat's type, dm_key or
--     created_by afterwards.
--   * No message notification (and so no push) to a member who has blocked
--     the sender or whom the sender has blocked.
--
-- Both apps already create DMs through open_or_create_dm and insert only
-- 'group' chats, so neither needs a change.

begin;

drop policy if exists "chat_members insert by creator" on public.chat_members;
create policy "chat_members insert by creator" on public.chat_members
  for insert to authenticated
  with check (
    public.is_chat_creator(chat_id)
    and (
      user_id = (select auth.uid())
      or (
        coalesce(role, 'member') = 'member'
        and exists (select 1 from public.chats c
                     where c.id = chat_members.chat_id and c.type = 'group')
        and not public.is_blocked_between(chat_members.user_id, (select auth.uid()))
        and public.may_message(chat_members.user_id, (select auth.uid()))
      )
    )
  );

drop policy if exists "chats create own" on public.chats;
create policy "chats create own" on public.chats
  for insert to authenticated
  with check (created_by = (select auth.uid()) and type = 'group');

-- What a chat IS never changes from the app. SECURITY INVOKER so current_user
-- is the role that issued the UPDATE; definer code (merges, deletes) is
-- untouched.
create or replace function public.guard_chat_identity()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user in ('authenticated', 'anon') then
    new.type       := old.type;
    new.created_by := old.created_by;
    new.dm_key     := old.dm_key;
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_chat_identity() from public, anon, authenticated;

drop trigger if exists tr_guard_chat_identity on public.chats;
create trigger tr_guard_chat_identity
  before update on public.chats
  for each row execute function public.guard_chat_identity();

-- Latest notify_on_message is 0093's; only the block filter is new.
create or replace function public.notify_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Written by record_call_in_chat (0045), not by a person. The call has its
  -- own incoming-call notification below and its own row in the chat.
  if new.type = 'call' then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  select cm.user_id, new.from_user_id, 'message',
    jsonb_build_object(
      'chat_id', new.chat_id,
      'message_id', new.id,
      'kind', coalesce(new.type, 'text'),
      -- Only a text message has a body worth previewing. A voice note's text
      -- column is empty and an image's is a caption at best; send-push names
      -- the kind instead of showing a blank line.
      'text', case when coalesce(new.type, 'text') = 'text'
                   then left(coalesce(new.text, ''), 60) else '' end)
  from public.chat_members cm
  where cm.chat_id = new.chat_id
    and cm.user_id <> new.from_user_id
    -- 0116: a block in either direction means no notification and no push.
    and not exists (select 1 from public.blocks b
                     where (b.blocker_id = cm.user_id and b.blocked_id = new.from_user_id)
                        or (b.blocker_id = new.from_user_id and b.blocked_id = cm.user_id));
  return new;
end; $$;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'adding members checks may_message' as check,
       case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
                   where polrelid = 'public.chat_members'::regclass
                     and polname = 'chat_members insert by creator') like '%may_message%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'the app can only create groups',
       case when (select pg_get_expr(polwithcheck, polrelid) from pg_policy
                   where polrelid = 'public.chats'::regclass
                     and polname = 'chats create own') like '%group%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'chat type is frozen',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.chats'::regclass and tgname = 'tr_guard_chat_identity'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'message notifications skip blocks',
       case when pg_get_functiondef('public.notify_on_message()'::regprocedure) like '%0116%'
            then 'OK' else 'NOT UPDATED' end
order by 1;
