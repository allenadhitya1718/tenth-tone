-- ============================================================
-- 0160 - push tokens say what the app can draw; iPhone VoIP token
--        (client round 4: WhatsApp-style notifications and calls)
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0159.
-- Safe to re-run.
--
-- caps       what this install of the app can do with a push, written by
--            the app with its token. send-push changes how it sends only
--            when the matching cap is present, so older installs keep
--            getting the pushes they understand:
--              'chat_style'  Android: messages arrive data-only and the app
--                            draws a WhatsApp-style conversation notification
--                            (sender photo, last messages, Reply, Mark as read)
--              'chat_reply'  iPhone: the message category with Reply and
--                            Mark as read is registered
--              'ringtone'    the FLYP ringtone / message tone channels exist
-- voip_token iPhone only: the PushKit token for this device. An incoming
--            call goes there as a VoIP push and the phone shows the native
--            CallKit call screen (like WhatsApp) instead of a banner.
-- ============================================================

begin;

alter table public.push_tokens
  add column if not exists caps text[] not null default '{}',
  add column if not exists voip_token text;

-- At most a handful of short words; keeps a client from storing junk.
alter table public.push_tokens drop constraint if exists push_tokens_caps_check;
alter table public.push_tokens add constraint push_tokens_caps_check
  check (cardinality(caps) <= 10 and coalesce(length(array_to_string(caps, ',')), 0) <= 200);

alter table public.push_tokens drop constraint if exists push_tokens_voip_token_check;
alter table public.push_tokens add constraint push_tokens_voip_token_check
  check (voip_token is null or voip_token ~ '^[0-9a-f]{32,200}$');

commit;

-- Checks (SELECT only)
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'push_tokens' and column_name in ('caps', 'voip_token')
 order by 1;
