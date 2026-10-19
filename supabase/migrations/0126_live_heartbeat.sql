-- 0126 - a live whose host disappeared ends by itself (host heartbeat)
--
-- Apply after 0125. Safe to re-run.
--
-- ============================================================
-- THE PROBLEM
-- ============================================================
-- A live ends only when the host taps End (endLive in mobile/src/api/live.ts:
-- UPDATE live_streams SET status = 'ended', ended_at = now()). If the host's
-- app is killed, the phone dies or the network drops for good, the row stays
-- 'live' forever: it sits in the browse list, viewers stare at a silent room,
-- live notifications keep opening it, and guests stay 'accepted'.
--
-- close_stale_live_streams (0038) was meant to sweep these but was never
-- scheduled, and it used started_at (a real two-hour live and a dead one look
-- the same). Worse, it is GRANTED TO authenticated with p_minutes clamped to
-- >= 1: any signed-in user could POST /rpc/close_stale_live_streams
-- {p_minutes: 1} and end every live on the platform. Revoked below.
--
-- ============================================================
-- THE FIX
-- ============================================================
-- 1. live_streams.last_heartbeat_at. Written only by live_heartbeat() (a host
--    cannot PATCH it: guard_live_stream, 0117, now pins it like the counters).
-- 2. live_heartbeat(p_live_id): the host's app calls it every 30 s while live
--    and when it returns to the foreground. Only the host of that stream may
--    call it (keyed on auth.uid(), so there is no "someone else" argument and
--    no called_as_rpc guard is needed); anyone else gets 'live_not_found'. A
--    beat less than 15 s after the previous one is accepted but not written,
--    so a tight loop cannot hammer the row (each write is also a realtime
--    event to every viewer). Returns the stream's status, so a host whose
--    stream was ended while it was away learns it at once.
-- 3. end_stale_lives(): ends, through the SAME transition the app makes
--    (status 'live' -> 'ended', ended_at set), every live that
--      * has sent a heartbeat but none for 90 seconds, or
--      * started more than 6 hours ago (hard cap; also sweeps the rows that
--        are already stuck today).
--    Because it is the same transition, the existing triggers do the rest,
--    exactly as when the host taps End:
--      tr_clear_live_viewers (0048)        live_viewers rows deleted
--      tr_close_live_guests_on_end (0103)  open stage rows -> 'left'
--      tr_notify_host_live_ended (0061)    host gets the 'live_ended' summary
--      realtime on live_streams (0046)     every open room shows "ended"
--    ended_at is the last sign of life (last heartbeat + 30 s, or the 6 h cap)
--    rather than the sweep time, so the host's duration is not inflated.
--    SECURITY DEFINER, executable by service_role only (pg_cron runs it as the
--    owner). guard_live_stream lets it through because current_user is the
--    owner, not 'authenticated'.
-- 4. A pg_cron job, every minute, if pg_cron is enabled (it is, see 0051).
--
-- COMPATIBILITY: a live that has NEVER sent a heartbeat (last_heartbeat_at
-- null) is only subject to the 6-hour cap. Hosts on older app builds and on
-- the web app (web/js), which do not send heartbeats, are therefore not cut
-- off after 90 seconds; their dead streams are swept at 6 h, as before this
-- migration (never). New mobile builds send the first beat as soon as the
-- room opens, so they get the 90-second rule. Rows already 'live' when this
-- runs are left null for the same reason (an old-build host may be live right
-- now); any of them older than 6 h end on the first sweep. Ended rows are
-- backfilled with their last known moment, so the column means something on
-- every historic row.

begin;

-- ── 1. The column ───────────────────────────────────────────────────────
alter table public.live_streams
  add column if not exists last_heartbeat_at timestamptz;

update public.live_streams
   set last_heartbeat_at = coalesce(ended_at, started_at)
 where status <> 'live'
   and last_heartbeat_at is null;

-- The sweep scans only live rows; 0038's idx_live_streams_live already covers
-- status = 'live'.

-- ── 2. A host cannot write it directly ──────────────────────────────────
-- guard_live_stream: latest 0117, verbatim apart from last_heartbeat_at.
create or replace function public.guard_live_stream()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status            := 'live';
    new.viewer_count      := 0;
    new.viewer_count_max  := 0;
    new.ended_at          := null;
    -- 0126: only live_heartbeat() writes it.
    new.last_heartbeat_at := null;
    return new;
  end if;

  new.host_id           := old.host_id;
  new.viewer_count      := old.viewer_count;
  new.viewer_count_max  := old.viewer_count_max;
  -- 0126: a host cannot keep a dead stream alive with a far-future value.
  new.last_heartbeat_at := old.last_heartbeat_at;

  -- The only status change a host makes is ending a live stream. Anything
  -- else (un-ban, re-open an ended stream) is ignored.
  if new.status is distinct from old.status
     and not (old.status = 'live' and new.status = 'ended') then
    new.status   := old.status;
    new.ended_at := old.ended_at;
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_live_stream() from public, anon, authenticated;
-- The trigger itself (tr_guard_live_stream, 0117) is unchanged.

-- ── 3. The heartbeat ────────────────────────────────────────────────────
create or replace function public.live_heartbeat(p_live_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me     uuid := auth.uid();
  v_host   uuid;
  v_status text;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;

  select host_id, status into v_host, v_status
    from public.live_streams where id = p_live_id;
  -- Someone else's stream is answered like a missing one: no oracle.
  if not found or v_host is distinct from v_me then
    raise exception 'live_not_found';
  end if;
  if v_status <> 'live' then
    return v_status;
  end if;

  -- Rate limit: at most one write per 15 s per stream.
  update public.live_streams
     set last_heartbeat_at = now()
   where id = p_live_id
     and status = 'live'
     and (last_heartbeat_at is null or last_heartbeat_at < now() - interval '15 seconds');

  return 'live';
end;
$fn$;
revoke all on function public.live_heartbeat(uuid) from public, anon;
grant execute on function public.live_heartbeat(uuid) to authenticated;

-- ── 4. The sweep ────────────────────────────────────────────────────────
create or replace function public.end_stale_lives()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n integer;
begin
  update public.live_streams
     set status   = 'ended',
         ended_at = case
                      when last_heartbeat_at is not null
                           and last_heartbeat_at < now() - interval '90 seconds'
                        then least(now(), last_heartbeat_at + interval '30 seconds')
                      else least(now(), started_at + interval '6 hours')
                    end
   where status = 'live'
     and (   (last_heartbeat_at is not null and last_heartbeat_at < now() - interval '90 seconds')
          or started_at < now() - interval '6 hours');
  get diagnostics n = row_count;
  return n;
end;
$fn$;
revoke all on function public.end_stale_lives() from public, anon, authenticated;
grant execute on function public.end_stale_lives() to service_role;

-- 0038's sweep: nobody calls it (checked mobile/, web/, supabase/functions),
-- and as granted it let any user end every live. Owner / service only now.
revoke all on function public.close_stale_live_streams(integer) from public, anon, authenticated;
grant execute on function public.close_stale_live_streams(integer) to service_role;

commit;

-- ── 5. Schedule it ──────────────────────────────────────────────────────
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - NOTHING HAS BEEN SCHEDULED. Enable it in Database -> Extensions and re-run this file.';
    return;
  end if;

  begin perform cron.unschedule('end-stale-lives'); exception when others then null; end;

  perform cron.schedule(
    'end-stale-lives',
    '* * * * *',
    $job$ select public.end_stale_lives(); $job$
  );
end;
$sched$;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'last_heartbeat_at column' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'live_streams'
                            and column_name = 'last_heartbeat_at')
            then 'OK' else 'MISSING' end as result
union all
select 'guard pins last_heartbeat_at',
       case when pg_get_functiondef('public.guard_live_stream()'::regprocedure) like '%0126%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'live_heartbeat callable by authenticated only',
       case when has_function_privilege('authenticated', 'public.live_heartbeat(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.live_heartbeat(uuid)', 'execute')
            then 'OK' else 'CHECK GRANTS' end
union all
select 'end_stale_lives not callable by clients',
       case when not has_function_privilege('authenticated', 'public.end_stale_lives()', 'execute')
             and not has_function_privilege('anon', 'public.end_stale_lives()', 'execute')
            then 'OK' else 'EXPOSED' end
union all
select 'close_stale_live_streams not callable by clients',
       case when not has_function_privilege('authenticated', 'public.close_stale_live_streams(integer)', 'execute')
             and not has_function_privilege('anon', 'public.close_stale_live_streams(integer)', 'execute')
            then 'OK' else 'EXPOSED' end
union all
select 'end_stale_lives SECURITY DEFINER (or the guard would undo it)',
       case when (select prosecdef from pg_proc where oid = 'public.end_stale_lives()'::regprocedure)
            then 'OK' else 'SECURITY INVOKER' end
union all
select 'cron job end-stale-lives',
       case when not exists (select 1 from pg_extension where extname = 'pg_cron')
              then 'PG_CRON NOT ENABLED'
            when exists (select 1 from cron.job where jobname = 'end-stale-lives')
              then 'OK' else 'NOT SCHEDULED' end
order by 1;

-- Lives still open and how long since their host was last heard from:
--   select id, host_id, started_at, last_heartbeat_at,
--          now() - coalesce(last_heartbeat_at, started_at) as silent_for
--     from public.live_streams where status = 'live' order by started_at;
--
-- Behavioural test: start a live from the new app build, kill the app, wait
-- two minutes. The row is 'ended', live_viewers for it is empty, its open
-- live_guests rows are 'left', the host has a 'live_ended' notification, and
-- any viewer still in the room sees the ended card. As the host:
--   update live_streams set last_heartbeat_at = now() + interval '1 day' where id = L
--     returning last_heartbeat_at;   -- unchanged
