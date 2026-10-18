-- ============================================================
-- 0099_message_delivery.sql
--
-- WhatsApp-style ticks on every message you send (client note 10):
--   one grey tick   - sent: the message row exists on the server
--   two grey ticks  - delivered: the other person's app has received it
--   two blue ticks  - read: the other person has opened the chat
--
-- Until now the chat showed only a "Seen" line under your last message.
-- "Read" already exists: chat_members.last_read_at (0041), stamped by
-- mark_chat_read() when a chat is opened. Nothing recorded "delivered".
--
-- chat_members gains last_delivered_at, stamped when the app RECEIVES
-- messages (a realtime insert arrives, the inbox loads) as opposed to when
-- the chat is opened. Per member rather than per message for the same reason
-- 0041 gave: a receipt row per (message x member) grows without bound, and a
-- tick only needs "is this message older than the other person's stamp".
--
-- How the app derives a tick for one of your own messages, per other member:
--   read       when message.created_at <= last_read_at
--   delivered  when message.created_at <= greatest(last_delivered_at, last_read_at)
--              (reading implies delivery; mark_chat_read is left unchanged)
--   sent       otherwise
-- In a group, a state counts only once EVERY other member has reached it,
-- i.e. compare against the minimum stamp across the other members.
-- A null stamp means "never stamped": treat it as joined_at, as 0041 does.
--
-- Both stamps and messages.created_at come from the database clock, so no
-- device clock is involved in the comparison.
--
-- Reading the stamps needs no new path: "chat_members self read" (0018)
-- already lets a member select every row of a chat they belong to, with no
-- column restriction, which is how fetchOtherLastRead reads last_read_at.
-- The same select can add last_delivered_at.
--
-- chat_members is added to the realtime publication so the sender's ticks
-- turn grey-to-grey-to-blue live, without a refetch. Realtime applies the
-- same RLS, so a subscriber only receives rows of chats they belong to.
--
-- Unread counts (0041) and message requests (0043) are untouched.
--
-- Safe to re-run. Apply after 0001..0096.
-- ============================================================

begin;

alter table public.chat_members
  add column if not exists last_delivered_at timestamptz;

-- Existing rows have never been stamped. Without this, every message ever
-- sent would show one tick until the other person next opens the app.
-- Whatever they have read was certainly delivered; failing that, joining.
update public.chat_members
   set last_delivered_at = coalesce(last_read_at, joined_at)
 where last_delivered_at is null;

-- ── Marking one chat delivered ──────────────────────────
-- Like mark_chat_read, the only write path to the column: a plain UPDATE
-- policy would let a member rewrite role, joined_at or accepted_at too.
-- The where clause on user_id is the membership check: a caller who is not a
-- member of p_chat_id has no row to update, so nothing happens.
--
-- The stamp only moves forward, and only when something newer from someone
-- else exists. That keeps a burst of calls from writing (and broadcasting a
-- realtime UPDATE) when there is nothing new to acknowledge.
create or replace function public.mark_chat_delivered(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members cm
     set last_delivered_at = greatest(cm.last_delivered_at, now())
   where cm.chat_id = p_chat_id
     and cm.user_id = (select auth.uid())
     and exists (
       select 1 from public.messages m
        where m.chat_id = cm.chat_id
          and m.from_user_id <> cm.user_id
          and m.created_at > coalesce(cm.last_delivered_at, cm.joined_at)
     );
$$;

-- ── Marking every chat delivered ────────────────────────
-- Called when the app comes to the foreground or loads the inbox: everything
-- the server holds for you up to now has reached your device. Same rules as
-- above, applied to all of the caller's memberships in one statement.
create or replace function public.mark_all_delivered()
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members cm
     set last_delivered_at = greatest(cm.last_delivered_at, now())
   where cm.user_id = (select auth.uid())
     and exists (
       select 1 from public.messages m
        where m.chat_id = cm.chat_id
          and m.from_user_id <> cm.user_id
          and m.created_at > coalesce(cm.last_delivered_at, cm.joined_at)
     );
$$;

-- Roles must be named (see 0073): `from public` alone leaves anon's grant.
revoke all on function public.mark_chat_delivered(uuid) from public, anon;
revoke all on function public.mark_all_delivered()      from public, anon;
grant execute on function public.mark_chat_delivered(uuid) to authenticated;
grant execute on function public.mark_all_delivered()      to authenticated;

-- ── Realtime ────────────────────────────────────────────
-- Without this the sender's ticks only change on reload.
do $$
begin
  begin
    alter publication supabase_realtime add table public.chat_members;
  exception
    when duplicate_object then null;   -- already published
    when undefined_object then null;   -- publication absent on this project
  end;
end $$;

commit;
