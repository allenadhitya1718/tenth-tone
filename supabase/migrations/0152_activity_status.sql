-- 0152 - Activity status: "Active now" / "Last seen ..." (owner request)
--
-- While the app is open it calls touch_presence() about once a minute (and
-- when it comes to the front or goes to the back). A chat header asks
-- get_presence() for the other person's last activity.
--
-- Privacy, as WhatsApp and Instagram:
--   * user_settings.show_activity_status (0029, default on) is honoured both
--     ways: someone who hides theirs is shown to nobody, and does not see
--     anybody else's either;
--   * only people who share a chat with you (a DM or a group) are shown;
--   * never across a block in either direction.
-- The table itself is not readable by the app at all; only get_presence
-- answers, and only with what these rules allow.
--
-- Needs 0001, 0027/0029 (user_settings), 0054 (is_blocked_between).
-- Safe to re-run.

begin;

create table if not exists public.user_presence (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  last_active_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from public, anon, authenticated;

-- "I am here". At most one write per 30 s per person, however often the app
-- calls it.
create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.user_presence as p (user_id, last_active_at)
  values (auth.uid(), now())
  on conflict (user_id) do update
    set last_active_at = excluded.last_active_at
    where p.last_active_at < now() - interval '30 seconds';
end;
$fn$;
revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

-- Last activity of up to 200 people, for those the rules above allow; the
-- rest are simply left out.
create or replace function public.get_presence(p_user_ids uuid[])
returns table (user_id uuid, last_active_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select p.user_id, p.last_active_at
    from public.user_presence p
   where auth.uid() is not null
     and p.user_id = any (p_user_ids[1:200])
     and p.user_id <> auth.uid()
     -- I show mine (or I could not see theirs).
     and coalesce((select s.show_activity_status from public.user_settings s
                    where s.user_id = auth.uid()), true)
     -- They show theirs.
     and coalesce((select s.show_activity_status from public.user_settings s
                    where s.user_id = p.user_id), true)
     and not public.is_blocked_between(p.user_id, auth.uid())
     and exists (select 1
                   from public.chat_members a
                   join public.chat_members b on b.chat_id = a.chat_id
                  where a.user_id = auth.uid() and b.user_id = p.user_id);
$fn$;
revoke all on function public.get_presence(uuid[]) from public, anon;
grant execute on function public.get_presence(uuid[]) to authenticated;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'presence table exists and is closed to the app' as check,
       case when to_regclass('public.user_presence') is not null
             and not has_table_privilege('authenticated', 'public.user_presence', 'select')
            then 'OK' else 'WRONG' end as result
union all
select 'touch_presence / get_presence callable by the app only',
       case when has_function_privilege('authenticated', 'public.touch_presence()', 'execute')
             and has_function_privilege('authenticated', 'public.get_presence(uuid[])', 'execute')
             and not has_function_privilege('anon', 'public.get_presence(uuid[])', 'execute')
            then 'OK' else 'WRONG' end
union all
select 'activity status setting exists',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'user_settings'
                            and column_name = 'show_activity_status')
            then 'OK' else 'MISSING (needs 0029)' end
order by 1;
