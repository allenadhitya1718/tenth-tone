-- ============================================================
-- 0041_chat_read_state.sql
--
-- The inbox gave no way to tell an unread conversation from one already
-- opened: every row looked identical whether it held a new message or one
-- read days ago. Nothing recorded when a person last looked at a chat.
--
-- chat_members gains last_read_at. Opening a chat stamps it, and a chat
-- counts as unread when it holds a message newer than that stamp which the
-- reader did not write themselves.
--
-- Deliberately per-member rather than per-message: a read receipt table
-- would grow with (messages x members) and nothing in the UI needs to know
-- WHICH message was read, only whether anything is newer than the last look.
-- ============================================================

alter table public.chat_members
  add column if not exists last_read_at timestamptz;

-- Existing rows have never been stamped. Leaving them null would show every
-- historic conversation as unread on first load; treat joining as a read.
update public.chat_members
   set last_read_at = joined_at
 where last_read_at is null;

-- The unread lookup is "messages in this chat newer than X, not mine".
create index if not exists idx_messages_chat_created
  on public.messages (chat_id, created_at desc);

-- ── Marking a chat read ──────────────────────────────────
-- A plain UPDATE policy would let a member rewrite role or joined_at on
-- their own row too. This function is the only write path, so last_read_at
-- is the only field that can move, and only ever on your own membership.
create or replace function public.mark_chat_read(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members
     set last_read_at = now()
   where chat_id = p_chat_id
     and user_id = auth.uid();
$$;

revoke all on function public.mark_chat_read(uuid) from public;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- ── Unread counts for the inbox ──────────────────────────
-- Returned in one call rather than a query per row: the inbox renders every
-- conversation at once, and a per-chat round trip made opening it visibly
-- slow as the list grew.
create or replace function public.chat_unread_counts()
returns table (chat_id uuid, unread_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select cm.chat_id,
         count(m.id)::integer as unread_count
    from public.chat_members cm
    left join public.messages m
           on m.chat_id = cm.chat_id
          and m.from_user_id <> cm.user_id          -- your own messages are not unread
          and m.created_at > coalesce(cm.last_read_at, cm.joined_at)
   where cm.user_id = auth.uid()
   group by cm.chat_id;
$$;

revoke all on function public.chat_unread_counts() from public;
grant execute on function public.chat_unread_counts() to authenticated;
