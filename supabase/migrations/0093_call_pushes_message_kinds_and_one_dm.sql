-- 0093 — three reported bugs, all of them here rather than in the app
--
-- 1. A CALL RECORD PUSHED ITS OWN JSON AT YOU. When a call ends, 0045 writes a
--    message of type 'call' into the chat whose `text` is a JSON blob
--    ({"kind":"video","status":"ended","seconds":145}). notify_on_message
--    notified on EVERY message, so that blob went out as a push: the phone
--    showed `Alim sent you a message` / `{"kind" : "video", "status" : ...`.
--    64 of those have been sent. A call record is not a message anybody sent;
--    it gets no notification at all now. And the other non-text kinds (voice,
--    image, location) were pushing an EMPTY body, so the payload now carries
--    the kind and send-push writes "sent a voice message" and the like.
--
-- 2. AN INCOMING CALL NEVER PUSHED AT ALL. Nothing anywhere inserted a
--    notification for a call, so the ONLY way to learn you were being called
--    was to have the app open with a live realtime subscription. With the app
--    closed the phone stayed silent and the call was recorded as missed - and
--    the same silence is why "add to call" looked broken: the invite ROW was
--    created correctly every time (they are all there in `calls`, mostly
--    `missed`), the invitee's phone simply never rang. One notification per
--    ringing call, which the existing push pipeline (0087/0090) delivers.
--
-- 3. TWO CHATS WITH THE SAME PERSON WAS POSSIBLE. openOrCreateDm read the
--    chats it could see and created one if it found none - a read-then-write
--    with no constraint under it, so two people pressing Message at the same
--    moment each saw nothing and each created one. FIVE such pairs exist,
--    and each twin was created in the same MINUTE as its sibling - the race
--    itself, on the record. They are merged below, and then made impossible:
--    a DM carries the pair as a key with a unique index over it, and a
--    SECURITY DEFINER function does find-or-create in one statement, so it
--    cannot depend on what the caller happens to be allowed to see either.

-- ── 1. Messages: no notification for a call record; name the other kinds ──

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
  where cm.chat_id = new.chat_id and cm.user_id <> new.from_user_id;
  return new;
end; $$;

-- ── 2. An incoming call raises a notification, which becomes a push ──

create or replace function public.notify_on_call()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only the moment it starts ringing. Accept/decline/end are seen by a
  -- screen that is already open, and must not buzz the phone again.
  if new.status <> 'ringing' then
    return null;
  end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (
    new.callee_id,
    new.caller_id,
    'system',                      -- no new type: the check constraint and
    jsonb_build_object(            -- every existing reader keep working
      'kind',      'incoming_call',
      'call_id',   new.id,
      'call_kind', new.kind,       -- audio | video
      'is_invite', new.root_id is not null
    ));
  return null;
end; $$;

drop trigger if exists tr_notify_call on public.calls;
create trigger tr_notify_call
  after insert on public.calls
  for each row execute function public.notify_on_call();

-- ── 2b. Deleting a chat that ever carried a call was impossible ──
--
-- guard_call_participants (0048) refuses any UPDATE that changes calls.chat_id
-- - correctly, because that is what stops a call being aimed at a conversation
-- you are not a member of. But calls.chat_id is ON DELETE SET NULL, and a
-- cascade's SET NULL *is* such an update. So deleting any chat that had ever
-- carried a call raised "call participants cannot be changed" and the delete
-- failed. Found while merging the duplicate DMs below; it applies to every
-- chat deletion in the app.
--
-- Clearing the link is safe in a way that re-pointing it is not: a call with
-- no chat is aimed at nobody. Only that one direction is allowed.
create or replace function public.guard_call_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id then
    raise exception 'call participants cannot be changed';
  end if;
  if new.chat_id is distinct from old.chat_id and new.chat_id is not null then
    raise exception 'a call cannot be moved to another chat';
  end if;
  return new;
end;
$$;

-- ── 3. One DM per pair, enforced by the database ──

alter table public.chats add column if not exists dm_key text;

-- Backfill: the pair, smaller id first, so the key is the same whoever asks.
update public.chats c
   set dm_key = k.key
  from (
    select cm.chat_id,
           least(min(cm.user_id::text), max(cm.user_id::text)) || ':' ||
           greatest(min(cm.user_id::text), max(cm.user_id::text)) as key
      from public.chat_members cm
     group by cm.chat_id
    having count(*) = 2
  ) k
 where k.chat_id = c.id and c.type = 'dm' and c.dm_key is null;

-- MERGE the duplicates that already exist. There are five pairs, and every
-- one of them was created in the SAME MINUTE as its twin (02 Sep 01:16, 02 Sep
-- 16:55, 11 Sep 01:51, 17 Sep 02:43, 18 Sep 17:52) - which is the race itself
-- on the record: two people opening the conversation at the same moment, each
-- seeing no chat, each making one.
--
-- The keeper is the one with the most messages (ties go to the older). Its
-- twin's messages and call records move across, then it is deleted -
-- chat_members goes with it by cascade, and the keeper already has both
-- people. Nothing is thrown away: every message ends up in the keeper.
do $$
declare r record; v_keep uuid;
begin
  for r in
    select dm_key from public.chats
     where type = 'dm' and dm_key is not null
     group by dm_key having count(*) > 1
  loop
    select id into v_keep from public.chats
     where type = 'dm' and dm_key = r.dm_key
     order by (select count(*) from public.messages m where m.chat_id = chats.id) desc,
              created_at asc
     limit 1;

    update public.messages m set chat_id = v_keep
     where m.chat_id in (select id from public.chats
                          where type = 'dm' and dm_key = r.dm_key and id <> v_keep);

    -- calls.chat_id is deliberately NOT moved: guard_call_participants (0048)
    -- forbids changing it, and rightly - it is what stops a call being aimed
    -- at a conversation you are not in. The FK is ON DELETE SET NULL, so the
    -- loser's ended calls simply lose a link they no longer need; the call
    -- RECORD people actually read is a message, and that has already moved.

    delete from public.chats
     where type = 'dm' and dm_key = r.dm_key and id <> v_keep;

    raise notice 'merged duplicate DM pair % into %', r.dm_key, v_keep;
  end loop;
end $$;

-- Now it can be made impossible. Still guarded: a migration that cannot
-- create the index should say so rather than fail everything behind it.
do $$
declare n integer;
begin
  select count(*) into n from (
    select dm_key from public.chats
     where type = 'dm' and dm_key is not null
     group by dm_key having count(*) > 1
  ) d;
  if n > 0 then
    raise warning 'dm_key: % duplicated pair(s) remain - unique index NOT created', n;
  else
    create unique index if not exists uq_chats_dm_key
      on public.chats (dm_key) where type = 'dm' and dm_key is not null;
  end if;
end $$;

-- Find-or-create in one place, running as the definer so it sees every DM
-- rather than only the ones the caller's policies reveal.
create or replace function public.open_or_create_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if p_other is null or p_other = v_me then raise exception 'cannot open a chat with yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'no such person';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  select id into v_id from public.chats where type = 'dm' and dm_key = v_key;
  if v_id is not null then return v_id; end if;

  insert into public.chats (type, created_by, dm_key)
  values ('dm', v_me, v_key)
  returning id into v_id;

  insert into public.chat_members (chat_id, user_id, role)
  values (v_id, v_me, 'member'), (v_id, p_other, 'member');

  return v_id;
exception
  when unique_violation then
    -- Someone else created it in the moment between the select and the
    -- insert. Theirs is as good as ours.
    select id into v_id from public.chats where type = 'dm' and dm_key = v_key;
    return v_id;
end; $$;

revoke all on function public.open_or_create_dm(uuid) from public;
grant execute on function public.open_or_create_dm(uuid) to authenticated;
