-- 0091 — messaging exactly like Instagram: anyone may message, strangers land
-- in Requests
--
-- Reverts 0089, which had made 'following' the default for who_can_message.
-- That was the wrong lever. Instagram does not stop a stranger sending you a
-- message; it puts that message in a REQUESTS tray you approve or decline,
-- and only then does it reach your inbox.
--
-- FLYP already had exactly that and it was working: chat_request_flags()
-- marks a chat as a request while you have not accepted it, you do not follow
-- the other person, and they have sent the first message; the inbox shows a
-- Requests tab for those, and the chat screen swaps the composer for an
-- accept/decline bar until you decide. Defaulting who_can_message to
-- 'following' bypassed all of that by refusing the message outright - the
-- stranger was told "this account is not accepting messages" and never
-- reached the tray.
--
-- So: the default goes back to 'everyone' and the tray does the filtering,
-- which is the Instagram behaviour the user asked for. Anyone who has chosen
-- 'following' or 'nobody' for themselves keeps that choice - this only
-- changes what an account with no explicit choice means.

alter table public.user_settings
  alter column who_can_message set default 'everyone';

create or replace function public.setting_text(p_user uuid, p_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  execute format('select %I from public.user_settings where user_id = $1', p_key)
    into v using p_user;
  return coalesce(v, 'everyone');
end;
$$;
