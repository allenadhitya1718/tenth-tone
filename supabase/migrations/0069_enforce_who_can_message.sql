-- 0069 — make "who can message me" actually stop messages
--
-- Found by testing with two accounts: account A set who_can_message to
-- 'nobody', and account B sent it a message anyway. The setting saved, the
-- screen showed it, and nothing enforced it.
--
-- ── Why it did nothing ──
-- There are two functions and they are not the same one.
--
--   may_message(target, actor)         — 0027, replaced in 0028. Implements
--                                        the rule correctly. Called ONLY from
--                                        the client, by API.canMessage, which
--                                        gates opening a NEW conversation.
--
--   may_message_in_chat(chat, actor)   — 0049. This is what the `messages`
--                                        insert policy actually calls, and it
--                                        checks blocking and nothing else.
--
-- So the rule applied to starting a chat, in the client, where anyone talking
-- to the API directly skips it — and never applied at all to a conversation
-- that already existed. Since a DM row survives forever once created, "nobody"
-- meant "nobody new, in the app, if they are being polite".
--
-- who_can_comment does not have this problem: 0027 wired may_comment_on()
-- straight into the comments insert policy, which is exactly the right shape.
-- Messages simply never got the same treatment.
--
-- ── The fix ──
-- One function. The policy already calls it, so nothing else changes.
--
-- Note the block check stays as is_blocked_between(). may_message() looks at
-- blocks in ONE direction only (has the target blocked the actor), while
-- is_blocked_between() covers both — so replacing the check outright would
-- have quietly let a person message someone THEY had blocked. The two are kept
-- side by side deliberately; the small overlap costs nothing.

create or replace function public.may_message_in_chat(p_chat uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_type text; v_other uuid;
begin
  select type into v_type from public.chats where id = p_chat;
  if v_type is null then return false; end if;

  -- Groups are unaffected. A per-person "who can message me" rule has no
  -- meaning in a room several people joined; leaving a group is the control
  -- that applies there.
  if v_type <> 'dm' then return true; end if;

  select user_id into v_other
    from public.chat_members
   where chat_id = p_chat and user_id <> p_actor
   limit 1;

  if v_other is null then return true; end if;          -- a chat with only you

  -- Both directions, unchanged from 0049.
  if public.is_blocked_between(v_other, p_actor) then return false; end if;

  -- NEW: the recipient's own choice, and their restrict list. This is the
  -- whole point of the migration — the same function the client was already
  -- consulting, now consulted where it cannot be skipped.
  return public.may_message(v_other, p_actor);
end;
$fn$;

revoke all on function public.may_message_in_chat(uuid, uuid) from public;
grant execute on function public.may_message_in_chat(uuid, uuid) to authenticated;


-- ── Verify ──
-- One query, because the SQL editor only shows the last statement's result.
-- Replace the two ids with a real pair who share a DM, then set the TARGET's
-- who_can_message to 'nobody' and re-run: allowed should flip to false.
--
--   select public.may_message_in_chat('<chat-id>'::uuid, '<sender-id>'::uuid) as allowed;
--
-- The behavioural test that matters, with two accounts:
--   1. Account A: Settings > who can message me > nobody
--   2. Account B, in an EXISTING conversation with A, sends a message
--   3. It must be refused. Before this migration it went through.
select 'may_message_in_chat now consults may_message' as check,
       case when pg_get_functiondef('public.may_message_in_chat(uuid,uuid)'::regprocedure)
                 like '%may_message(v_other%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'both-direction block check retained',
       case when pg_get_functiondef('public.may_message_in_chat(uuid,uuid)'::regprocedure)
                 like '%is_blocked_between%'
            then 'OK' else 'LOST — do not ship' end
union all
select 'comments already enforced (0027, for contrast)',
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'comments'
            and policyname = 'comments insert own'
       ) then 'OK' else 'MISSING' end
order by 1;
