-- 0115 - rate limits that a client could step around by changing the clock
--
-- Security review 2026-10, findings F04 (high), F18 and F22 (low). Apply
-- after 0114. Safe to re-run.
--
-- ============================================================
-- F04 - BACK-DATED ROWS WERE NEVER COUNTED
-- ============================================================
-- Every limit in 0050 / 0056 / 0094 counts the caller's rows with
--     created_at > now() - interval '1 hour'
-- (started_at for live_streams), and every one of those columns is written by
-- the CLIENT when it chooses to send it. Insert each message with
-- created_at = '2001-01-01' and the count stays at zero for ever: unlimited
-- messages, follows, comments, reports, calls, chats, lives - each of which
-- fans out into notifications, send-push and FCM. Or insert normally and then
-- UPDATE your own row's created_at into the past.
--
-- A message with type = 'call' also skipped the message limit entirely
-- (check_message_rate returns early for call records) and skipped the
-- notification too, and any member could write one.
--
-- Fixes:
--   * stamp_server_time(): on INSERT from the app the time column is now(),
--     on UPDATE from the app it keeps its old value. Attached to every table
--     a rate limit counts. SECURITY INVOKER and keyed on current_user, so
--     rows written by SECURITY DEFINER code (follow_or_request, triggers,
--     service jobs) are untouched - they already use the column default.
--   * check_message_rate (latest 0050): a 'call' record is exempt only when a
--     trigger writes it (pg_trigger_depth() > 1, i.e. record_call_in_chat).
--     From the app it is refused: call records are the server's to write.
--
-- calls.created_at is also stamped on insert by 0114; it is listed here too
-- so an UPDATE cannot move it.

create or replace function public.stamp_server_time()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_col text := coalesce(tg_argv[0], 'created_at');
  v     jsonb;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    v := jsonb_build_object(v_col, now());
  else
    v := jsonb_build_object(v_col, to_jsonb(old) -> v_col);
  end if;
  new := jsonb_populate_record(new, v);
  return new;
end;
$fn$;
revoke all on function public.stamp_server_time() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('follows',         'created_at'),
      ('comments',        'created_at'),
      ('messages',        'created_at'),
      ('reports',         'created_at'),
      ('likes',           'created_at'),
      ('videos',          'created_at'),
      ('live_comments',   'created_at'),
      ('chats',           'created_at'),
      ('calls',           'created_at'),
      ('support_tickets', 'created_at'),
      ('client_logs',     'created_at'),
      ('live_streams',    'started_at')
    ) as t(tbl, col)
  loop
    if exists (select 1 from pg_attribute a
                where a.attrelid = to_regclass('public.' || r.tbl)
                  and a.attname = r.col and not a.attisdropped) then
      execute format('drop trigger if exists trg_00_server_time on public.%I', r.tbl);
      execute format(
        'create trigger trg_00_server_time before insert or update on public.%I '
        'for each row execute function public.stamp_server_time(%L)', r.tbl, r.col);
    else
      raise notice 'stamp_server_time: public.%.% not found, skipped', r.tbl, r.col;
    end if;
  end loop;
end $$;

-- Latest check_message_rate is 0050's; only the 'call' branch changes.
create or replace function public.check_message_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n_total integer; n_chat integer;
begin
  -- Records written by triggers (call records) must not be counted against
  -- the person, and must never be blocked. Only a trigger may write one.
  if new.type = 'call' then
    if pg_trigger_depth() > 1 then return new; end if;
    raise exception 'call records are written by the server'
      using errcode = 'check_violation';
  end if;

  select count(*) into n_total from public.messages
   where from_user_id = new.from_user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_total, 200, 'messages');

  select count(*) into n_chat from public.messages
   where from_user_id = new.from_user_id
     and chat_id = new.chat_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_chat, 60, 'messages to this conversation');

  return new;
end;
$$;


-- ============================================================
-- F18 - SHARES AND WATCH TIME WITHOUT A CEILING
-- ============================================================
-- increment_share_count() (0016) added 1 to any video's shares_count per call,
-- with no limit: a loop could push any video up every ranking that weighs
-- shares (0108 weighs them). Now a share counts once per person per video per
-- day, at most 100 counted shares per person per hour, and only for a video
-- that is published and public. Calls past that are accepted and ignored, so
-- the app never sees an error for sharing twice.
--
-- track_engagement() (0011) accepted any p_watch_ms / p_loop_count. Its effect
-- is confined to the caller's own video_engagement row, but one call could
-- still claim days of watch time. Each call is now clamped to 10 minutes and
-- 20 loops.

create table if not exists public.share_events (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  video_id   uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.share_events enable row level security;
revoke all on public.share_events from anon, authenticated;
create index if not exists idx_share_events_user_created
  on public.share_events (user_id, created_at desc);

create or replace function public.increment_share_count(p_video_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  n_hour integer;
begin
  if v_me is null or p_video_id is null then return; end if;

  if not exists (select 1 from public.videos v
                  where v.id = p_video_id
                    and v.privacy = 'public'
                    and coalesce(v.is_draft, false) = false
                    and coalesce(v.is_hidden, false) = false) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('share:' || v_me::text, 0));

  delete from public.share_events
   where user_id = v_me and created_at < now() - interval '1 day';

  if exists (select 1 from public.share_events
              where user_id = v_me and video_id = p_video_id) then
    return;
  end if;

  select count(*) into n_hour from public.share_events
   where user_id = v_me and created_at > now() - interval '1 hour';
  if n_hour >= 100 then return; end if;

  insert into public.share_events (user_id, video_id) values (v_me, p_video_id);
  update public.videos set shares_count = shares_count + 1 where id = p_video_id;
end;
$$;
revoke all on function public.increment_share_count(uuid) from public, anon;
grant execute on function public.increment_share_count(uuid) to authenticated;

-- Latest 4-argument track_engagement is 0011's; only the clamps are new.
create or replace function public.track_engagement(
  p_video_id        uuid,
  p_watch_ms        integer default 0,
  p_loop_count      integer default 0,
  p_completion_pct  numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_ms    integer := least(greatest(coalesce(p_watch_ms, 0), 0), 600000);
  v_loops integer := least(greatest(coalesce(p_loop_count, 0), 0), 20);
  v_pct   numeric := least(greatest(coalesce(p_completion_pct, 0), 0), 1);
begin
  if v_user is null or p_video_id is null then
    return;
  end if;

  insert into public.video_engagement (user_id, video_id, watch_count, total_watch_ms, max_completion_pct, last_watched_at)
  values (v_user, p_video_id, v_loops + 1, v_ms, v_pct, now())
  on conflict (user_id, video_id) do update set
    watch_count         = public.video_engagement.watch_count + v_loops + 1,
    total_watch_ms       = public.video_engagement.total_watch_ms + v_ms,
    max_completion_pct   = greatest(public.video_engagement.max_completion_pct, v_pct),
    last_watched_at       = now();
end;
$$;
revoke all on function public.track_engagement(uuid, integer, integer, numeric) from public, anon;
grant execute on function public.track_engagement(uuid, integer, integer, numeric) to authenticated;

-- 0010's 3-argument overload, if it is still there, gets the same clamps.
do $$
begin
  if to_regprocedure('public.track_engagement(uuid, integer, integer)') is not null then
    execute $f$
      create or replace function public.track_engagement(
        p_video_id   uuid,
        p_watch_ms   integer default 0,
        p_loop_count integer default 0
      )
      returns void
      language plpgsql
      security definer
      set search_path = public
      as $b$
      declare
        v_user  uuid := auth.uid();
        v_ms    integer := least(greatest(coalesce(p_watch_ms, 0), 0), 600000);
        v_loops integer := least(greatest(coalesce(p_loop_count, 0), 0), 20);
      begin
        if v_user is null or p_video_id is null then
          return;
        end if;
        insert into public.video_engagement (user_id, video_id, watch_count, total_watch_ms, last_watched_at)
        values (v_user, p_video_id, v_loops + 1, v_ms, now())
        on conflict (user_id, video_id) do update set
          watch_count     = public.video_engagement.watch_count + v_loops + 1,
          total_watch_ms  = public.video_engagement.total_watch_ms + v_ms,
          last_watched_at = now();
      end;
      $b$;
    $f$;
  end if;
end $$;


-- ============================================================
-- F22 - client_logs had no ceiling
-- ============================================================
-- The other tables named in F22 are bounded by their primary keys (saves,
-- video_feedback, message_reactions, video_engagement: one row per person per
-- target; story_views: one per person per story, and its insert policy's
-- subquery on stories already runs under "stories read visible", i.e.
-- can_view_story). client_logs is append-only per call: 120 rows an hour per
-- person, and a 16 KB cap on one row's detail.

create or replace function public.check_client_log_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if pg_column_size(new.detail) > 16384 then
    new.detail := jsonb_build_object('truncated', true);
  end if;
  if new.ua is not null and length(new.ua) > 512 then
    new.ua := left(new.ua, 512);
  end if;
  select count(*) into n from public.client_logs
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 120, 'diagnostic reports');
  return new;
end;
$$;
revoke all on function public.check_client_log_rate() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.client_logs') is not null then
    drop trigger if exists trg_client_log_rate on public.client_logs;
    create trigger trg_client_log_rate
      before insert on public.client_logs
      for each row execute function public.check_client_log_rate();
  end if;
end $$;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'server time stamped on ' || c.relname as check,
       case when exists (select 1 from pg_trigger t
                          where t.tgrelid = c.oid and t.tgname = 'trg_00_server_time'
                            and not t.tgisinternal)
            then 'OK' else 'MISSING' end as result
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('follows', 'comments', 'messages', 'reports', 'likes', 'videos',
                     'live_comments', 'chats', 'calls', 'support_tickets', 'live_streams')
union all
select 'call records only from triggers',
       case when pg_get_functiondef('public.check_message_rate()'::regprocedure) like '%pg_trigger_depth() > 1%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'share count is metered',
       case when pg_get_functiondef('public.increment_share_count(uuid)'::regprocedure) like '%share_events%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'client_logs rate limited',
       case when to_regclass('public.client_logs') is null
              or exists (select 1 from pg_trigger where tgname = 'trg_client_log_rate')
            then 'OK' else 'MISSING' end
order by 1;
