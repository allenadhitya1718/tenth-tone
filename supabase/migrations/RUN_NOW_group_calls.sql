-- =============================================================
-- FLYP - paste this WHOLE file into the Supabase SQL editor and run it once.
--
--   Dashboard -> your project -> SQL Editor -> New query -> paste -> Run
--
-- It combines the two group-call migrations that may not be applied:
--
--   0094_group_calls_second_pass.sql   what the first real invites showed
--   0095_call_records_for_invites.sql  a call you were added to now leaves
--                                      a record in your chat
--   0096_call_records_are_not_requests.sql  that record lands in their INBOX,
--                                      not the Requests tab, and reports the
--                                      time THEY were in the call
--
-- SAFE TO RUN MORE THAN ONCE, and safe to run even if 0094 was already
-- applied: every function is CREATE OR REPLACE and every trigger is dropped
-- before it is created. Running it twice changes nothing the second time.
--
-- 0095 depends on 0094's call_member_set (a live member is never demoted by a
-- later ring), which is why they are together here rather than separate.
--
-- The last statement prints two check rows. Both should read true.
-- =============================================================



-- ############################################################
-- ##  0094_group_calls_second_pass.sql
-- ############################################################

-- 0094 — group calls, second pass: what the first real invites showed
--
-- Every invite tried between real accounts on 18 Sep ended 'missed', and the
-- one that was answered was undone two seconds later by a second invite for
-- the same person. Four causes; three are here, the fourth (a call push that
-- opened a call screen with no Accept on it) is in the client.
--
--   1. call_member_set() overwrote status unconditionally. A 'ringing' write
--      landed on a 'joined' row and threw that person out of the membership,
--      and the next hang-up ended the call for everyone (fewer than two
--      'joined'). A live member is never demoted by a ring, a decline or a
--      miss again; only 'left' and the root ending move them.
--   2. leave_call() only knew 'joined'. Someone rung from a push who never
--      reached 'joined' had nothing to leave, so the client fell back to
--      ending the ROOT - one person leaving hung up on everyone. A ringing
--      member leaving now declines their own invite instead, and the function
--      reports that as handled.
--   3. Invites paid the per-pair call rate limit (10 an hour), so retrying an
--      Add that seemed not to work locked the pair out. Invites keep the
--      overall cap and skip the per-pair one.
--   4. Nothing stopped an invite - or a call - across a block, and an invite
--      could ring a person into a channel with someone they had blocked. Both
--      refused at insert, with the word 'blocked' for the client to show.

-- ── 1. A live member is never demoted by a later ring ──────────────────

create or replace function public.call_member_set(p_channel text, p_user uuid, p_root uuid, p_by uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.call_members (channel, user_id, root_id, invited_by, status, joined_at, left_at)
  values (p_channel, p_user, p_root, p_by, p_status,
          case when p_status = 'joined' then now() end,
          case when p_status in ('left', 'declined', 'missed') then now() end)
  on conflict (channel, user_id) do update
    set status     = case
                       when public.call_members.status = 'joined'
                        and excluded.status in ('ringing', 'declined', 'missed') then 'joined'
                       else excluded.status
                     end,
        root_id    = coalesce(public.call_members.root_id, excluded.root_id),
        invited_by = coalesce(public.call_members.invited_by, excluded.invited_by),
        joined_at  = case
                       when excluded.status = 'joined' and public.call_members.status <> 'joined' then now()
                       else public.call_members.joined_at
                     end,
        left_at    = case
                       when excluded.status = 'left' then now()
                       when excluded.status in ('declined', 'missed')
                        and public.call_members.status <> 'joined' then now()
                       when excluded.status = 'joined' then null
                       else public.call_members.left_at
                     end;
end;
$$;

-- ── 2. Leaving while still 'ringing' ───────────────────────────────────

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
  if n > 0 then return true; end if;
  -- Rung into this channel and never joined: decline the invite(s) that
  -- rang us. tr_calls_sync_members marks the membership declined; the root
  -- is untouched (call_members_end_root counts only 'left').
  update public.calls set status = 'declined', ended_at = now()
   where channel = p_channel and callee_id = auth.uid()
     and root_id is not null and status = 'ringing';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ── 3. Invites skip the per-pair cap ───────────────────────────────────

create or replace function public.check_call_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n_total integer; n_callee integer;
begin
  select count(*) into n_total from public.calls
   where caller_id = new.caller_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_total, 20, 'calls');

  if new.root_id is null then
    select count(*) into n_callee from public.calls
     where caller_id = new.caller_id
       and callee_id = new.callee_id
       and root_id is null
       and created_at > now() - interval '1 hour';
    perform public.rate_limit_exceeded(n_callee, 10, 'calls to this person');
  end if;
  return new;
end;
$$;

-- ── 4. No call and no invite across a block ────────────────────────────

create or replace function public.guard_call_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked_between(new.caller_id, new.callee_id) then
    raise exception 'blocked';
  end if;
  if new.root_id is not null and exists (
       select 1 from public.call_members m
        where m.channel = new.channel
          and m.status in ('joined', 'ringing')
          and m.user_id <> new.callee_id
          and public.is_blocked_between(m.user_id, new.callee_id)) then
    raise exception 'blocked';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_call_block on public.calls;
create trigger trg_call_block
  before insert on public.calls
  for each row execute function public.guard_call_block();


-- ############################################################
-- ##  0095_call_records_for_invites.sql
-- ############################################################

-- 0095 — a call you were added to leaves a record in your chat
--
-- Reported: "when i add him in call the call log must be updated in his chat,
-- i dont see anything new in his chat." Nothing ever appeared, and there were
-- two independent reasons - either one alone was enough to lose the record.
--
--   1. An invite row carries no chat_id. record_call_in_chat (0045) opens with
--      `if new.chat_id is null then return null` - "a call placed outside a
--      conversation has nowhere to go" - so every invite fell straight out of
--      it. Fixed in the CLIENT (db.js inviteToCall now resolves the DM between
--      inviter and invitee and puts it on the row), because the chat has to be
--      CREATED if the two have never spoken, and that is not the database's
--      job to do inside a trigger.
--
--   2. An ACCEPTED invite never reached a terminal status at all, so the
--      trigger could not have fired even with a chat to write to. 0092 ends
--      the root and then sweeps up only the invites still ringing:
--
--        update public.calls set status = 'missed' ...
--         where root_id = new.id and status = 'ringing';
--
--      An invite that was answered stayed 'accepted' for ever. That is this
--      migration: it also ends the answered ones, which is what produces
--      their record - and it is the right status for them, because they were
--      a real conversation that is now over, not a missed ring.
--
-- Ordering inside the branch is deliberate. The membership rows are settled
-- FIRST, so that when the invite rows end and re-enter this same trigger,
-- call_member_set is writing 'left' onto a row that is already 'left' rather
-- than racing the sweep. 0094's guard permits joined -> left (it blocks only
-- ringing/declined/missed from demoting a live member), so that pass is a
-- no-op rather than a fight.
--
-- Safe to run more than once.

create or replace function public.calls_sync_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_root uuid;
begin
  v_root := coalesce(new.root_id, new.id);

  if tg_op = 'INSERT' then
    if new.root_id is null then
      -- A direct call: the caller is in from the start.
      perform public.call_member_set(new.channel, new.caller_id, v_root, null, 'joined');
    end if;
    -- The callee - of the call or of the invite - is ringing (or already in,
    -- for a row written as accepted).
    perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id,
                                   case when new.status = 'accepted' then 'joined' else 'ringing' end);
    return null;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id, 'joined');
    elsif new.status in ('declined', 'missed') then
      perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id, new.status);
    elsif new.status = 'ended' and new.root_id is null then
      -- The root call is over: whoever was still in it has left, whoever was
      -- still ringing was missed - and so were any invites still ringing.
      update public.call_members set status = 'left',   left_at = now() where channel = new.channel and status = 'joined';
      update public.call_members set status = 'missed', left_at = now() where channel = new.channel and status = 'ringing';
      update public.calls set status = 'missed', ended_at = now() where root_id = new.id and status = 'ringing';
      -- And the invites that were ANSWERED. Without this they stayed
      -- 'accepted' for ever, which is both untrue and the reason no call
      -- record was ever written for somebody who was added to a call: the
      -- record is written on the transition into a terminal status, and
      -- these rows never made one.
      update public.calls set status = 'ended', ended_at = now()
       where root_id = new.id and status = 'accepted';
    elsif new.status = 'ended' and new.root_id is not null then
      -- An invite row ended: the inviter cancelled a ring, an old client hung
      -- up by ending the row it was opened with, or the sweep above just
      -- closed an answered invite because the root finished.
      perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id,
                                     case when old.status = 'ringing' then 'missed' else 'left' end);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_calls_sync_members on public.calls;
create trigger tr_calls_sync_members
  after insert or update on public.calls
  for each row execute function public.calls_sync_members();

-- ── Check ────────────────────────────────────────────────
-- Expect: ends_accepted_invites = true
select 'calls_sync_members' as check,
       (prosrc like '%root_id = new.id and status = ''accepted''%') as ends_accepted_invites
  from pg_proc where proname = 'calls_sync_members';




-- ############################################################
-- ##  0096_call_records_are_not_requests.sql
-- ############################################################

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
