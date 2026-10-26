-- ============================================================
-- 0161 - WhatsApp behaviour for message notifications (client round 4)
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0160.
-- Safe to re-run.
--
-- 1. Mute a chat, as on WhatsApp: 8 hours, 1 week or always.
--    chat_members.muted_until (null = not muted; 'infinity' = always).
--    set_chat_muted() is the only write path (your own membership only).
--    send-push sends no message push while the chat is muted; the message
--    still arrives and still counts as unread.
--
-- 2. Reading a chat clears its notification on every phone. When
--    mark_chat_read moves last_read_at forward and there were message
--    notifications for that chat since the last read, send-push gets
--    { chat_read: { chat_id, user_id } } and sends that person's phones a
--    quiet data push; the app takes the chat's notification away (Android)
--    or removes the delivered alerts (iPhone).
-- ============================================================

begin;

-- ── 1. Mute ────────────────────────────────────────────────────────────
alter table public.chat_members add column if not exists muted_until timestamptz;

create or replace function public.set_chat_muted(p_chat_id uuid, p_until timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz := case when p_until is null or p_until <= now() then null else p_until end;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  update public.chat_members
     set muted_until = v_until
   where chat_id = p_chat_id and user_id = auth.uid();
  if not found then raise exception 'not_a_member'; end if;
  return v_until;
end;
$$;
revoke all on function public.set_chat_muted(uuid, timestamptz) from public, anon;
grant execute on function public.set_chat_muted(uuid, timestamptz) to authenticated;

-- send-push asks this (service role) before a message push.
create or replace function public.chat_is_muted(p_chat_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chat_members
                  where chat_id = p_chat_id and user_id = p_user_id
                    and muted_until is not null and muted_until > now());
$$;
revoke all on function public.chat_is_muted(uuid, uuid) from public, anon, authenticated;


-- ── 2. Read on one phone, cleared on all ───────────────────────────────
create or replace function public.push_on_chat_read()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ep     public.job_endpoints%rowtype;
  v_schema text := public.pg_net_schema();
begin
  -- Only when there was something to clear: a message notification for this
  -- chat since the previous read.
  if not exists (select 1 from public.notifications n
                  where n.user_id = new.user_id and n.type = 'message'
                    and n.payload->>'chat_id' = new.chat_id::text
                    and n.created_at > coalesce(old.last_read_at, '-infinity'::timestamptz)
                    and n.created_at > now() - interval '7 days') then
    return null;
  end if;
  if v_schema is null then return null; end if;
  select * into v_ep from public.job_endpoints where name = 'send-push';
  if not found or coalesce(v_ep.url, '') = '' then return null; end if;
  begin
    execute format('select %I.http_post(url := $1, body := $2, headers := $3)', v_schema)
      using v_ep.url,
            jsonb_build_object('chat_read', jsonb_build_object('chat_id', new.chat_id, 'user_id', new.user_id)),
            v_ep.headers;
  exception when others then
    raise warning 'push_on_chat_read: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke all on function public.push_on_chat_read() from public, anon, authenticated;

drop trigger if exists tr_push_on_chat_read on public.chat_members;
create trigger tr_push_on_chat_read
  after update of last_read_at on public.chat_members
  for each row
  when (new.last_read_at is distinct from old.last_read_at
        and (old.last_read_at is null or new.last_read_at > old.last_read_at))
  execute function public.push_on_chat_read();

commit;

-- Checks (SELECT only)
select 'muted_until column' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'chat_members' and column_name = 'muted_until')
            then 'OK' else 'MISSING' end as result
union all
select 'read-sync trigger',
       case when exists (select 1 from pg_trigger where tgname = 'tr_push_on_chat_read') then 'OK' else 'MISSING' end
union all
select 'chat_is_muted private',
       case when not has_function_privilege('authenticated', 'public.chat_is_muted(uuid,uuid)', 'execute') then 'OK' else 'EXPOSED' end;
