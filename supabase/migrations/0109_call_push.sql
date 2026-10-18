-- 0109 — a call that stops ringing tells the callee's phones
--
-- Since 0093 an incoming call raises a notification, which send-push turns
-- into a push. With the app closed that push is now a ringing, full-screen
-- call notification (Android) or a time-sensitive alert (iPhone) - and it
-- kept ringing after the caller had hung up, because nothing told the phone.
--
-- This trigger does. When a calls row LEAVES 'ringing' (accepted, declined,
-- missed, ended) it POSTs { call_id } to send-push, through the same
-- job_endpoints row and pg_net path the notification trigger uses (0087 /
-- 0090). send-push re-reads the row with the service role and sends the
-- callee's phones a "call over" push: the ringing notification goes away,
-- and when nobody answered it becomes "Missed call from <name>".
--
-- No notifications row is written for this: it is a signal to the phone,
-- not something for the bell list (the chat already gets its call record
-- from 0045 / 0096).
--
-- Depends on: 0019 (calls), 0087 (job_endpoints 'send-push'), 0090
-- (pg_net_schema()). Safe to run more than once. Not applied by the app.

create or replace function public.push_on_call_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ep     public.job_endpoints%rowtype;
  v_schema text := public.pg_net_schema();
begin
  if old.status is distinct from 'ringing' or new.status = 'ringing' then
    return null;
  end if;
  if v_schema is null then return null; end if;
  select * into v_ep from public.job_endpoints where name = 'send-push';
  if not found or coalesce(v_ep.url, '') = '' then return null; end if;
  begin
    execute format('select %I.http_post(url := $1, body := $2, headers := $3)', v_schema)
      using v_ep.url, jsonb_build_object('call_id', new.id), v_ep.headers;
  exception when others then
    -- Never fail the call update because the HTTP queue had a bad moment.
    raise warning 'push_on_call_end: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.push_on_call_end() from public, anon, authenticated;

drop trigger if exists tr_push_on_call_end on public.calls;
create trigger tr_push_on_call_end
  after update of status on public.calls
  for each row
  when (old.status = 'ringing' and new.status is distinct from 'ringing')
  execute function public.push_on_call_end();


-- ── Verification ─────────────────────────────────────────
-- Run after applying. Every row should read 'yes'.
select 'push_on_call_end()' as object,
       case when to_regprocedure('public.push_on_call_end()') is not null then 'yes' else 'MISSING' end as installed
union all select 'tr_push_on_call_end on calls',
       case when exists (select 1 from pg_trigger
                          where tgname = 'tr_push_on_call_end'
                            and tgrelid = 'public.calls'::regclass
                            and not tgisinternal)
            then 'yes' else 'MISSING' end
union all select 'tr_notify_call (0093) still installed',
       case when exists (select 1 from pg_trigger
                          where tgname = 'tr_notify_call'
                            and tgrelid = 'public.calls'::regclass)
            then 'yes' else 'MISSING' end
union all select 'send-push endpoint configured',
       case when exists (select 1 from public.job_endpoints
                          where name = 'send-push' and coalesce(url, '') <> '')
            then 'yes' else 'MISSING' end
union all select 'pg_net reachable',
       case when public.pg_net_schema() is not null then 'yes' else 'MISSING' end;
