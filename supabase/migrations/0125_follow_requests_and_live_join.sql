-- 0125 - follow-request loops, and joining a live you cannot see
--
-- Security review 2026-10, round 3. Apply after 0124. Safe to re-run.
--
-- ============================================================
-- 1. REQUEST -> CANCEL -> REQUEST SENT UNLIMITED PUSHES
-- ============================================================
-- follow_or_request() (latest 0030) writes a 'follow_request' notification
-- with `on conflict do nothing`, but notifications has no unique index, so
-- that clause never fires. Cancelling (deleting your follow_requests row,
-- "follow_requests delete either side") and asking again wrote a new
-- notification - and a push - every time, with nothing counting.
--
-- Now:
--   * follow_or_request() writes the notification only if the same requester
--     has not already notified the same target in the last 24 hours. The
--     function is 0030's verbatim apart from that.
--   * follow_requests gets an hourly rate trigger (60, as follows in 0050)
--     and the 0115 server-time stamp, so a client cannot back-date rows.
--
-- ============================================================
-- 2. join_live_stream() LET ANYONE INTO ANY LIVE
-- ============================================================
-- join_live_stream() (latest 0048) is SECURITY DEFINER and checked only that
-- the stream was 'live'. Anyone with a stream id could add themselves to the
-- viewer list (and count) of a friends-only live, or of a host who blocked
-- them. It now applies the same rule as the "live read" policy (0123): host,
-- or not blocked by the host and public / mutual friends for 'friends'; and
-- the stream must be live. A stream you may not see answers 0, exactly like
-- one that is not live, which is what the app already handles
-- (mobile/src/api/live.ts joinLiveStream returns the count, 0 on failure).
--
-- notify_on_live() (latest 0030) told every FOLLOWER when a friends-only
-- live started, i.e. people who are not allowed to see it. For
-- privacy = 'friends' only mutual follows are notified now; for public
-- lives nothing changes.

begin;

-- ── 1a. follow_or_request: one request notification per day ────────────
create or replace function public.follow_or_request(p_target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me      uuid := auth.uid();
  v_private boolean;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if v_me = p_target then raise exception 'cannot follow yourself'; end if;

  -- A block in either direction stops this outright.
  if exists (select 1 from public.blocks
              where (blocker_id = p_target and blocked_id = v_me)
                 or (blocker_id = v_me and blocked_id = p_target)) then
    raise exception 'blocked';
  end if;

  if exists (select 1 from public.follows
              where follower_id = v_me and followed_id = p_target) then
    return 'following';
  end if;

  select coalesce(is_private, false) into v_private
  from public.profiles where id = p_target;

  if not coalesce(v_private, false) then
    insert into public.follows (follower_id, followed_id)
    values (v_me, p_target)
    on conflict do nothing;
    return 'following';
  end if;

  insert into public.follow_requests (requester_id, target_id)
  values (v_me, p_target)
  on conflict do nothing;

  -- The request itself is worth a notification, otherwise it sits unseen.
  -- 0125: but only once a day per requester, however often it is withdrawn
  -- and asked again (notifications has no unique index for an
  -- `on conflict` to use).
  if public.setting_bool(p_target, 'notif_follows')
     and not exists (select 1 from public.notifications n
                      where n.user_id = p_target
                        and n.actor_id = v_me
                        and n.type = 'follow_request'
                        and n.created_at > now() - interval '24 hours') then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (p_target, v_me, 'follow_request', '{}'::jsonb);
  end if;

  return 'requested';
end;
$fn$;

revoke all on function public.follow_or_request(uuid) from public, anon;
grant execute on function public.follow_or_request(uuid) to authenticated;

-- ── 1b. follow_requests: rate limit and server time ─────────────────────
create index if not exists idx_follow_requests_requester_created
  on public.follow_requests (requester_id, created_at desc);

create or replace function public.check_follow_request_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.follow_requests
   where requester_id = new.requester_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 60, 'follow requests');
  return new;
end;
$$;
revoke all on function public.check_follow_request_rate() from public, anon, authenticated;

drop trigger if exists trg_follow_request_rate on public.follow_requests;
create trigger trg_follow_request_rate
  before insert on public.follow_requests
  for each row execute function public.check_follow_request_rate();

drop trigger if exists trg_00_server_time on public.follow_requests;
create trigger trg_00_server_time
  before insert or update on public.follow_requests
  for each row execute function public.stamp_server_time('created_at');

-- ── 2a. join_live_stream: only a stream you may see ─────────────────────
-- Latest is 0048's; the visibility test is new.
create or replace function public.join_live_stream(p_live_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_count integer;
begin
  if v_me is null then raise exception 'not signed in'; end if;

  -- 0125: the "live read" rule (0123) plus status 'live'. A stream you may
  -- not see is answered like one that is not live.
  if not exists (
    select 1 from public.live_streams ls
     where ls.id = p_live_id
       and ls.status = 'live'
       and (
         ls.host_id = v_me
         or (
           not public.has_blocked(ls.host_id, v_me)
           and (
             ls.privacy = 'public'
             or (
               ls.privacy = 'friends'
               and exists (select 1 from public.follows
                            where follower_id = v_me and followed_id = ls.host_id)
               and exists (select 1 from public.follows
                            where follower_id = ls.host_id and followed_id = v_me)
             )
           )
         )
       )
  ) then
    return 0;
  end if;

  -- One row per person. A second call by the same user changes nothing.
  insert into public.live_viewers (live_id, user_id)
  values (p_live_id, v_me)
  on conflict (live_id, user_id) do nothing;

  select count(*) into v_count from public.live_viewers where live_id = p_live_id;

  update public.live_streams
     set viewer_count = v_count,
         viewer_count_max = greatest(viewer_count_max, v_count)
   where id = p_live_id;

  return v_count;
end;
$$;

revoke all on function public.join_live_stream(uuid) from public, anon;
grant execute on function public.join_live_stream(uuid) to authenticated;

-- ── 2b. notify_on_live: a friends-only live tells only friends ──────────
-- Latest is 0030's; only the friends filter is new.
create or replace function public.notify_on_live()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.status <> 'live' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'live' then return new; end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  select f.follower_id, new.host_id, 'live',
         jsonb_build_object('stream_id', new.id, 'title', left(coalesce(new.title, ''), 60))
  from public.follows f
  where f.followed_id = new.host_id
    and public.setting_bool(f.follower_id, 'notif_live')
    and not exists (select 1 from public.blocks b
                     where b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
    and not exists (select 1 from public.muted_users m
                     where m.user_id = f.follower_id and m.muted_id = new.host_id)
    -- 0125: a friends-only live is announced to friends (mutual follows) only,
    -- and never to someone the host has blocked.
    and not exists (select 1 from public.blocks b
                     where b.blocker_id = new.host_id and b.blocked_id = f.follower_id)
    and (coalesce(new.privacy, 'public') <> 'friends'
         or exists (select 1 from public.follows back
                     where back.follower_id = new.host_id
                       and back.followed_id = f.follower_id));
  return new;
end; $fn$;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'follow request notification deduplicated' as check,
       case when pg_get_functiondef('public.follow_or_request(uuid)'::regprocedure) like '%0125%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'follow_requests rate limited',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.follow_requests'::regclass
                            and tgname = 'trg_follow_request_rate' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'follow_requests server time',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.follow_requests'::regclass
                            and tgname = 'trg_00_server_time' and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'join_live_stream checks visibility',
       case when pg_get_functiondef('public.join_live_stream(uuid)'::regprocedure) like '%has_blocked%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'notify_on_live: friends-only lives notify friends only',
       case when pg_get_functiondef('public.notify_on_live()'::regprocedure) like '%0125%'
            then 'OK' else 'NOT UPDATED' end
order by 1;
