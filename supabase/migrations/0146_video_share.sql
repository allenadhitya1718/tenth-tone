-- 0146 (NOT APPLIED YET) - sending a video into a chat ("Send to")
--
-- Owner request: the feed's share button opens an in-app "Send to" sheet,
-- like Instagram: pick recent chats, groups or people, add a note, Send. The
-- chosen chats get a video card (thumbnail, creator, caption, play icon)
-- instead of a bare link.
--
-- Apply after 0144 (and after 0145 if that is applied; 0145 does not touch
-- messages). Safe to re-run. Nothing is back-filled or deleted. Redeploy
-- send-push alongside (it gains a translated 'video_share' push label).
--
-- ============================================================
-- WHAT CHANGES
-- ============================================================
-- 1. messages.type gains 'video_share'. No new column: the shared video is
--    carried by the canonical share link in attachment_url,
--    'https://flyp-sa.com/v/<video uuid>' (videoLink in
--    mobile/src/api/discover.ts), and the same link is written to text, so
--    an older app that does not know 'video_share' shows the link as a text
--    bubble (which still opens the video). The app reads the video id back
--    out of attachment_url.
-- 2. messages_video_share_url_check: a 'video_share' row must carry exactly
--    that link shape (lower-case uuid), so nobody can make a video card point
--    at an arbitrary address.
-- 3. Whether the video can be SEEN is not checked here: the card is resolved
--    by each viewer under the videos RLS policies, and a deleted, hidden,
--    archived or private-not-allowed video shows "Video unavailable".
-- 4. Message notifications for a shared video carry kind 'video_share' and
--    text '[Video]' (send-push shows its own translated label for the kind;
--    an older send-push shows '[Video]').
-- 5. Rate limits (0050/0115) are unchanged: a share is an ordinary message
--    (one per chat, plus one more when a note is added).
--
-- RLS is unchanged.

begin;

-- ── 1. messages.type ────────────────────────────────────────────────────
-- Restated in full (a check constraint cannot be added to); the list is
-- 0144's plus 'video_share'.
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system',
                  'file', 'location', 'call', 'gif', 'video_share'));

-- ── 2. the link shape ───────────────────────────────────────────────────
alter table public.messages drop constraint if exists messages_video_share_url_check;
alter table public.messages
  add constraint messages_video_share_url_check
  check (type <> 'video_share'
         or (attachment_url is not null
             and attachment_url ~ '^https://flyp-sa\.com/v/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));

-- ── 3. what a shared video says in a notification ──────────────────────
-- 0144's notify_on_message, plus '[Video]' for a 'video_share'.
create or replace function public.notify_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Written by record_call_in_chat (0045), not by a person. The call has its
  -- own incoming-call notification below and its own row in the chat.
  if new.type = 'call' then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  select cm.user_id, new.from_user_id, 'message',
    jsonb_build_object(
      'chat_id', new.chat_id,
      'message_id', new.id,
      'kind', coalesce(new.type, 'text'),
      -- Only a text message has a body worth previewing. A voice note's text
      -- column is empty and an image's is a caption at best; send-push names
      -- the kind instead of showing a blank line. 0144: a GIF's text is its
      -- Tenor description, not something the sender wrote, so it reads
      -- '[GIF]' (shown as is by a send-push without the 'gif' label).
      -- 0146: a shared video's text is its link; it reads '[Video]'.
      'text', case when coalesce(new.type, 'text') = 'text'
                   then left(coalesce(new.text, ''), 60)
                   when new.type = 'gif' then '[GIF]'
                   when new.type = 'video_share' then '[Video]'
                   else '' end)
  from public.chat_members cm
  where cm.chat_id = new.chat_id
    and cm.user_id <> new.from_user_id
    -- 0116: a block in either direction means no notification and no push.
    and not exists (select 1 from public.blocks b
                     where (b.blocker_id = cm.user_id and b.blocked_id = new.from_user_id)
                        or (b.blocker_id = new.from_user_id and b.blocked_id = cm.user_id));
  return new;
end; $$;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'messages accept type video_share' as check,
       case when pg_get_constraintdef((select oid from pg_constraint
                                        where conrelid = 'public.messages'::regclass
                                          and conname = 'messages_type_check')) like '%video_share%'
             and pg_get_constraintdef((select oid from pg_constraint
                                        where conrelid = 'public.messages'::regclass
                                          and conname = 'messages_type_check')) like '%gif%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'video_share messages limited to the share link',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.messages'::regclass and conname = 'messages_video_share_url_check')
            then 'OK' else 'MISSING' end
union all
select 'share link shape (accepts the canonical link, refuses others)',
       case when 'https://flyp-sa.com/v/0b6f3c3e-1d2a-4b5c-8d9e-0123456789ab' ~ '^https://flyp-sa\.com/v/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             and not ('https://flyp-sa.com.evil.example/v/0b6f3c3e-1d2a-4b5c-8d9e-0123456789ab' ~ '^https://flyp-sa\.com/v/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
             and not ('http://flyp-sa.com/v/0b6f3c3e-1d2a-4b5c-8d9e-0123456789ab' ~ '^https://flyp-sa\.com/v/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
             and not ('https://flyp-sa.com/v/0b6f3c3e-1d2a-4b5c-8d9e-0123456789ab/x' ~ '^https://flyp-sa\.com/v/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            then 'OK' else 'WRONG' end
union all
select 'message notifications say [Video] (and still [GIF], still skip blocks)',
       case when pg_get_functiondef('public.notify_on_message()'::regprocedure) like '%[Video]%'
             and pg_get_functiondef('public.notify_on_message()'::regprocedure) like '%[GIF]%'
             and pg_get_functiondef('public.notify_on_message()'::regprocedure) like '%0116%'
            then 'OK' else 'NOT UPDATED' end
order by 1;
