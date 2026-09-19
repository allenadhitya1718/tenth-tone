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
