-- ============================================================
-- 0100_latest_message_per_chat.sql
--
-- The inbox (and the share sheet's "recent chats") needs one thing per
-- conversation: its newest message, for the preview line and the sort order.
-- To get it the app selected EVERY message of EVERY chat the user belongs to,
-- newest first, and kept the first row it saw per chat. That transfer grows
-- with the whole message history, so the inbox got slower the more people
-- talked, and a long group chat alone could make it crawl.
--
-- chat_latest_messages(p_chat_ids) returns exactly one row per chat: its
-- newest message. Same result as the client-side loop, a few rows instead of
-- the whole history.
--
-- Implementation: one index probe per chat (a LATERAL ... LIMIT 1 over
-- idx_messages_chat_created) rather than `distinct on (chat_id)`. Both return
-- the same rows; distinct on still has to read every message of every chat on
-- the server before discarding all but one, whereas the lateral form stops at
-- the first index entry for each chat.
--
-- SECURITY INVOKER, so the caller's RLS still applies: "messages members read"
-- (0018) hides every message of a chat the caller does not belong to. Chats
-- the caller is not a member of are also skipped up front, so passing a
-- stranger's chat id costs nothing and returns nothing.
--
-- messages has no soft-delete flag (deleting a message deletes the row), so
-- there is nothing to filter; a deleted latest message is simply replaced by
-- the one before it. A chat with no messages returns no row.
--
-- Safe to re-run. Apply after 0001..0096.
-- ============================================================

begin;

-- Already created by 0001 and repeated by 0041; kept here so this file stands
-- on its own. A no-op when the index exists.
create index if not exists idx_messages_chat_created
  on public.messages (chat_id, created_at desc);

create or replace function public.chat_latest_messages(p_chat_ids uuid[])
returns table (
  id             uuid,
  chat_id        uuid,
  from_user_id   uuid,
  type           text,
  text           text,
  attachment_url text,
  reply_to_id    uuid,
  created_at     timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.id,
         m.chat_id,
         m.from_user_id,
         m.type,
         m.text,
         m.attachment_url,
         m.reply_to_id,
         m.created_at
    from (select distinct c.chat_id
            from unnest(p_chat_ids) as c(chat_id)
           where c.chat_id is not null
             and public.is_chat_member(c.chat_id)) as ids
    cross join lateral (
      select mm.id, mm.chat_id, mm.from_user_id, mm.type, mm.text,
             mm.attachment_url, mm.reply_to_id, mm.created_at
        from public.messages mm
       where mm.chat_id = ids.chat_id
       order by mm.created_at desc
       limit 1
    ) as m
   order by m.created_at desc;
$$;

-- Roles must be named (see 0073): `from public` alone leaves anon's grant.
revoke all on function public.chat_latest_messages(uuid[]) from public, anon;
grant execute on function public.chat_latest_messages(uuid[]) to authenticated;

commit;
