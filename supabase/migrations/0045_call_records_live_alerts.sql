-- ============================================================
-- 0045_call_records_live_alerts.sql
--
-- Two things that happened but left no trace.
--
--   1. Calls. You could ring someone, talk, hang up — and the conversation
--      showed nothing. No record of who called, when, whether it connected,
--      or how long it lasted. Every messenger keeps that line in the thread.
--
--   2. Going live. A stream started and nobody was told, so a broadcast was
--      only found by whoever happened to be looking at the live tab.
--
-- Both are written by triggers rather than by the app: whichever side hangs
-- up, and whichever client starts the stream, the record still gets made.
-- ============================================================

-- ── 1. Call records in the conversation ──────────────────

-- 'call' joins the allowed message types. The list is restated in full
-- because a check constraint cannot be added to.
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system',
                  'file', 'location', 'call'));

-- The detail is stored as JSON in `text` rather than in new columns: the app
-- has to render "Video call · 2:34" in Arabic or English, so it needs the
-- parts, not a sentence built in the database that could only be one language.
create or replace function public.record_call_in_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer := 0;
begin
  -- Only when the call actually reaches a terminal state, and only on the
  -- transition into it — an update that touches something else must not
  -- write a second record.
  if new.status not in ('ended', 'declined', 'missed') then
    return null;
  end if;
  if old.status is not distinct from new.status then
    return null;
  end if;
  if new.chat_id is null then
    return null;   -- a call placed outside a conversation has nowhere to go
  end if;

  if new.status = 'ended' and new.answered_at is not null then
    v_seconds := greatest(0, extract(epoch from (coalesce(new.ended_at, now()) - new.answered_at))::integer);
  end if;

  insert into public.messages (chat_id, from_user_id, type, text)
  values (
    new.chat_id,
    new.caller_id,          -- attributed to whoever placed the call
    'call',
    json_build_object(
      'kind',    new.kind,          -- audio | video
      'status',  new.status,        -- ended | declined | missed
      'seconds', v_seconds
    )::text
  );

  return null;
end;
$$;

drop trigger if exists tr_record_call_in_chat on public.calls;
create trigger tr_record_call_in_chat
  after update on public.calls
  for each row execute function public.record_call_in_chat();

-- ── 2. Telling followers a stream started ────────────────

-- 'live' joins the notification types, again restating the whole list.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like', 'comment', 'follow', 'mention', 'message',
                  'system', 'live'));

create or replace function public.notify_followers_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'live' then
    return null;
  end if;

  -- One row per follower. Blocked people are excluded here rather than
  -- filtered on read, so a block genuinely stops the notification existing.
  insert into public.notifications (user_id, actor_id, type, payload)
  select f.follower_id,
         new.host_id,
         'live',
         json_build_object('live_id', new.id, 'title', coalesce(new.title, ''))
    from public.follows f
   where f.followed_id = new.host_id
     and not exists (
       select 1 from public.blocks b
        where (b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
           or (b.blocker_id = new.host_id and b.blocked_id = f.follower_id)
     );

  return null;
end;
$$;

drop trigger if exists tr_notify_followers_live on public.live_streams;
create trigger tr_notify_followers_live
  after insert on public.live_streams
  for each row execute function public.notify_followers_live();
