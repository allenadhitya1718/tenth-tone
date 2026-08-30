-- ============================================================
-- 0043_message_requests.sql
--
-- Message requests, the way Instagram does them.
--
-- Until now a DM from a complete stranger landed in the inbox beside the
-- people you actually talk to, with nothing marking it as unsolicited and no
-- way to refuse it short of blocking the sender.
--
-- A conversation is a REQUEST for you when you have not accepted it and you
-- do not follow the other person. Following them is itself consent, so a
-- message from someone you follow is never a request. Sending a reply
-- accepts it, which is what accepting means in practice.
-- ============================================================

alter table public.chat_members
  add column if not exists accepted_at timestamptz;

-- Existing conversations are all already-accepted; without this backfill the
-- whole inbox would move into Requests the moment this is applied.
update public.chat_members
   set accepted_at = coalesce(accepted_at, joined_at)
 where accepted_at is null;

-- ── Which of my chats are requests ────────────────────────
-- Returned for the whole inbox in one call, like chat_unread_counts.
--
-- A chat counts as a request when all of these hold:
--   * I have not accepted it
--   * I follow nobody in it
--   * somebody other than me has actually written something
-- The last condition matters: a chat I created and have not yet used is not
-- a request from anyone, and should not appear in that tab.
create or replace function public.chat_request_flags()
returns table (chat_id uuid, is_request boolean)
language sql
security definer
stable
set search_path = public
as $$
  select cm.chat_id,
         (
           cm.accepted_at is null
           and not exists (
             select 1
               from public.chat_members other
               join public.follows f
                 on f.followed_id = other.user_id
               where other.chat_id = cm.chat_id
                 and other.user_id <> cm.user_id
                 and f.follower_id = cm.user_id
           )
           and exists (
             select 1 from public.messages m
              where m.chat_id = cm.chat_id
                and m.from_user_id <> cm.user_id
           )
         ) as is_request
    from public.chat_members cm
   where cm.user_id = auth.uid();
$$;

revoke all on function public.chat_request_flags() from public;
grant execute on function public.chat_request_flags() to authenticated;

-- ── Accepting ────────────────────────────────────────────
create or replace function public.accept_chat_request(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members
     set accepted_at = now()
   where chat_id = p_chat_id
     and user_id = auth.uid()
     and accepted_at is null;
$$;

revoke all on function public.accept_chat_request(uuid) from public;
grant execute on function public.accept_chat_request(uuid) to authenticated;

-- ── Declining ────────────────────────────────────────────
-- Removes you from the conversation. The other person is not told, which is
-- the point: declining must not be a signal back to a stranger.
create or replace function public.decline_chat_request(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.chat_members
   where chat_id = p_chat_id
     and user_id = auth.uid();
$$;

revoke all on function public.decline_chat_request(uuid) from public;
grant execute on function public.decline_chat_request(uuid) to authenticated;

-- ── Replying accepts ─────────────────────────────────────
-- Answering a stranger is acceptance; making people also press a button
-- would be asking twice for the same decision.
create or replace function public.accept_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_members
     set accepted_at = now()
   where chat_id = new.chat_id
     and user_id = new.from_user_id
     and accepted_at is null;
  return null;
end;
$$;

drop trigger if exists tr_accept_on_reply on public.messages;
create trigger tr_accept_on_reply
  after insert on public.messages
  for each row execute function public.accept_on_reply();
