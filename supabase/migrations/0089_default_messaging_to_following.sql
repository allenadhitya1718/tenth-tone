-- 0089 — "who can message me" defaults to people I follow
--
-- Asked for by the user after a friend was told "this account is not
-- accepting messages": the rule works, the default was the surprise. New
-- accounts now start at 'following'. Accounts that already chose a value
-- keep it; accounts with no settings row at all are read as 'following'
-- too, so the fallback matches the column default instead of disagreeing
-- with it. Every other setting keeps its 'everyone' fallback.

alter table public.user_settings
  alter column who_can_message set default 'following';

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
  return coalesce(v, case when p_key = 'who_can_message' then 'following' else 'everyone' end);
end;
$$;
