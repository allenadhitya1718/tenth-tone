-- 0096 — a call record must be visible, and must report YOUR time in the call
--
-- Two faults an adversarial read of 0095 found, both of which would have left
-- the original complaint ("i dont see anything new in his chat") only
-- half-fixed.
--
-- ── 1. The record would land in the Requests tab ───────────────────────
--
-- chat_request_flags (0043) marks a conversation a REQUEST when all three
-- hold: my accepted_at is null, I follow nobody else in it, and somebody else
-- has written in it. Add someone to a call who does not follow you and all
-- three are true the moment the call record lands - so it appears under
-- "طلبات" rather than in their inbox. The Add sheet lists people YOU follow,
-- which says nothing about whether they follow you, so this is the ordinary
-- case rather than an edge one.
--
-- Being CALLED is not a cold message. Their phone rang, with your name on it;
-- the conversation that ring created is not a stranger's unsolicited text,
-- and the same person can already reach them far more intrusively than by
-- writing. So a call record accepts the callee's side of the chat. Only the
-- callee's, only when a record is actually written, and only if it was not
-- already accepted.
--
-- This deliberately does NOT weaken message requests: nothing here touches a
-- chat that has no call in it, and blocking and the call rate limits (0056,
-- 0094) still decide whether the phone may ring at all.
--
-- ── 2. The duration was whatever the WHOLE call lasted ─────────────────
--
-- 0095 ends an answered invite when the ROOT ends. If the invited person
-- leaves early - talks for a minute and hangs up while the others carry on
-- for half an hour - their row was still 'accepted' at that point, so it was
-- swept with the root and the record read "مكالمة · 31:00" for a minute of
-- conversation. It is wrong for both people in that chat, by however long the
-- call outlived them.
--
-- leave_call already knows the moment somebody leaves, so it closes their own
-- invite there. The 0095 sweep then finds nothing left to close for them, so
-- there is no second record either.
--
-- Safe to run more than once. Needs 0094 and 0095 (RUN_NOW_group_calls.sql).

-- ── 1. A call record is not a message request ──────────────────────────

create or replace function public.record_call_in_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer := 0;
begin
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

  -- The person who was rung has met this caller - their phone rang with that
  -- name on it - so the conversation carrying the record is not a request.
  -- Without this the record is written where they will not look.
  update public.chat_members
     set accepted_at = now()
   where chat_id = new.chat_id
     and user_id = new.callee_id
     and accepted_at is null;

  return null;
end;
$$;

drop trigger if exists tr_record_call_in_chat on public.calls;
create trigger tr_record_call_in_chat
  after update on public.calls
  for each row execute function public.record_call_in_chat();

-- ── 2. Leaving closes your own invite, so the record is your time ──────

create or replace function public.leave_call(p_channel text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.call_members set status = 'left', left_at = now()
   where channel = p_channel and user_id = auth.uid() and status = 'joined';
  get diagnostics n = row_count;

  if n > 0 then
    -- We were really in the call. If we got here through an INVITE, close
    -- that invite now rather than leaving it for the root's sweep: the sweep
    -- runs whenever everyone else finishes, so the record would claim every
    -- minute of a call we had already left.
    update public.calls set status = 'ended', ended_at = now()
     where channel = p_channel and callee_id = auth.uid()
       and root_id is not null and status = 'accepted';
    return true;
  end if;

  -- Rung into this channel and never joined: decline the invite(s) that rang
  -- us. tr_calls_sync_members marks the membership declined; the root is
  -- untouched (call_members_end_root counts only 'left').
  update public.calls set status = 'declined', ended_at = now()
   where channel = p_channel and callee_id = auth.uid()
     and root_id is not null and status = 'ringing';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.leave_call(text) from public;
grant execute on function public.leave_call(text) to authenticated;

-- ── Check ────────────────────────────────────────────────
-- Both must come back true.
select
  (select prosrc like '%accepted_at = now()%'
     from pg_proc where proname = 'record_call_in_chat' limit 1)  as m0096_record_accepts_callee,
  (select prosrc like '%root_id is not null and status = ''accepted''%'
     from pg_proc where proname = 'leave_call' limit 1)           as m0096_leave_closes_own_invite;
