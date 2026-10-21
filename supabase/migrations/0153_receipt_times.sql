-- 0153 - Read and delivered TIMES for message info (owner request)
--
-- Message info listed who had read a message but not when: chat_members only
-- keeps the latest stamps (last_read_at 0041, last_delivered_at 0099), which
-- say how far someone has got, not when they got past a given message.
--
-- Now every time a member's stamp moves forward, the moment is logged
-- (chat_receipt_log). A stamp is always set to now() when it moves (opening
-- the chat, the app receiving messages), so for one message:
--   read at       = the first 'read' entry at or after the message was sent
--   delivered at  = the first 'delivered' or 'read' entry at or after it
-- which is exactly when that person's phone received / opened it.
--
-- message_receipt_times(message) answers only the message's sender, for the
-- people still in the chat. Messages read before this file have no entry and
-- come back with a null time (the app then shows the status without a time).
-- Entries older than 60 days are pruned now and then.
--
-- Needs 0041, 0099. Safe to re-run.

begin;

create table if not exists public.chat_receipt_log (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind    text not null check (kind in ('read', 'delivered')),
  at      timestamptz not null
);
create index if not exists idx_chat_receipt_log_lookup
  on public.chat_receipt_log (chat_id, user_id, kind, at);
alter table public.chat_receipt_log enable row level security;
revoke all on public.chat_receipt_log from public, anon, authenticated;

create or replace function public.log_chat_receipts()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.last_read_at is not null and new.last_read_at is distinct from old.last_read_at
     and (old.last_read_at is null or new.last_read_at > old.last_read_at) then
    insert into public.chat_receipt_log (chat_id, user_id, kind, at)
    values (new.chat_id, new.user_id, 'read', new.last_read_at);
  end if;
  if new.last_delivered_at is not null and new.last_delivered_at is distinct from old.last_delivered_at
     and (old.last_delivered_at is null or new.last_delivered_at > old.last_delivered_at) then
    insert into public.chat_receipt_log (chat_id, user_id, kind, at)
    values (new.chat_id, new.user_id, 'delivered', new.last_delivered_at);
  end if;
  -- Now and then, forget what no message info will ask about any more.
  if random() < 0.002 then
    delete from public.chat_receipt_log where at < now() - interval '60 days';
  end if;
  return null;
end;
$fn$;
revoke all on function public.log_chat_receipts() from public, anon, authenticated;

drop trigger if exists tr_log_chat_receipts on public.chat_members;
create trigger tr_log_chat_receipts
  after update of last_read_at, last_delivered_at on public.chat_members
  for each row execute function public.log_chat_receipts();

-- For the sender of one message: when each other member received and read
-- it (null = not yet, or before this was recorded).
create or replace function public.message_receipt_times(p_message_id uuid)
returns table (user_id uuid, delivered_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select cm.user_id,
         (select min(l.at) from public.chat_receipt_log l
           where l.chat_id = m.chat_id and l.user_id = cm.user_id
             and l.at >= m.created_at) as delivered_at,
         (select min(l.at) from public.chat_receipt_log l
           where l.chat_id = m.chat_id and l.user_id = cm.user_id and l.kind = 'read'
             and l.at >= m.created_at) as read_at
    from public.messages m
    join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id <> m.from_user_id
   where m.id = p_message_id
     and m.from_user_id = auth.uid();
$fn$;
revoke all on function public.message_receipt_times(uuid) from public, anon;
grant execute on function public.message_receipt_times(uuid) to authenticated;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'receipt log exists and is closed to the app' as check,
       case when to_regclass('public.chat_receipt_log') is not null
             and not has_table_privilege('authenticated', 'public.chat_receipt_log', 'select')
            then 'OK' else 'WRONG' end as result
union all
select 'stamps are logged as they move',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.chat_members'::regclass
                            and tgname = 'tr_log_chat_receipts' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'message_receipt_times callable by the app only',
       case when has_function_privilege('authenticated', 'public.message_receipt_times(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.message_receipt_times(uuid)', 'execute')
            then 'OK' else 'WRONG' end
order by 1;
