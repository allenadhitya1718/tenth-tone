-- 0150 - A call nobody answered is recorded as missed
--
-- Owner report: a missed call showed in the chat as a plain "Voice call".
-- When the CALLER hangs up while the other phone is still ringing, the app
-- ends the call ('ended', answered_at null), and record_call_in_chat (0096)
-- wrote that as {"status":"ended","seconds":0}: an ordinary call. Only a
-- call that rang out ('missed') or was refused ('declined') was marked.
--
-- Now an 'ended' call that was never answered is recorded as 'missed', and
-- every record carries "answered" so the app does not have to guess from the
-- duration. Group call roots are answered when they start (0145), so a group
-- call people joined is never shown as missed.
--
-- The app shows it as WhatsApp does: "Missed voice call" (red) to the person
-- rung, "Voice call · No answer" to the caller. Records written before this
-- file ('ended', 0 seconds, no "answered") are read the same way by the app.
--
-- Otherwise unchanged from 0096 (the record is not a message request).
-- Needs 0045, 0096. Safe to re-run.

begin;

create or replace function public.record_call_in_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds  integer := 0;
  v_answered boolean := new.answered_at is not null;
  v_status   text := new.status;
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

  if new.status = 'ended' and v_answered then
    v_seconds := greatest(0, extract(epoch from (coalesce(new.ended_at, now()) - new.answered_at))::integer);
  end if;
  -- The caller gave up while it rang: for the person rung, a missed call.
  if new.status = 'ended' and not v_answered then
    v_status := 'missed';
  end if;

  insert into public.messages (chat_id, from_user_id, type, text)
  values (
    new.chat_id,
    new.caller_id,          -- attributed to whoever placed the call
    'call',
    json_build_object(
      'kind',     new.kind,     -- audio | video
      'status',   v_status,     -- ended | declined | missed
      'seconds',  v_seconds,
      'answered', v_answered
    )::text
  );

  -- The person who was rung has met this caller - their phone rang with that
  -- name on it - so the conversation carrying the record is not a request.
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

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'unanswered ended calls are recorded as missed' as check,
       case when pg_get_functiondef('public.record_call_in_chat()'::regprocedure) like '%v_status := ''missed''%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'call records say whether they were answered',
       case when pg_get_functiondef('public.record_call_in_chat()'::regprocedure) like '%''answered'', v_answered%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'trigger in place',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.calls'::regclass
                            and tgname = 'tr_record_call_in_chat' and not tgisinternal)
            then 'OK' else 'MISSING' end
order by 1;
