-- ============================================================
-- 0110 — process media_delete_queue
--
-- 0102 queues the media_url and poster_url of every deleted story (owner
-- delete, admin delete, nightly purge, account cascade) in
-- public.media_delete_queue, and said plainly that nothing consumed it. This
-- is the consumer's database half; the other half is the Edge Function
-- media-delete-queue.
--
-- ── Independent of media-reconcile ──
-- This job is NOT the media-reconcile sweep (0064) and does not depend on it.
-- That sweep is currently paused; pausing or resuming it changes nothing here.
-- This job never lists the bucket: it only ever acts on keys that are
-- explicitly in media_delete_queue, and even then deletes a key only when no
-- column in media-upload's REFERENCED_BY list still points at it. Everything
-- else (not our URL, still referenced, a check that errored) is kept.
--
-- What it adds:
--   1. Bookkeeping columns on the queue: status, attempts, next_attempt_at,
--      claimed_at, last_error, outcome, done_at.
--   2. claim_media_delete_batch()  hands out due rows with FOR UPDATE SKIP
--      LOCKED, so two overlapping runs never take the same row. A row stuck in
--      'processing' for 15 minutes (a run that died) becomes due again.
--   3. settle_media_delete()       records the result; failures retry with
--      backoff (30 min doubling, capped at 24 h) and give up as 'failed' after
--      the attempt limit the function passes (8).
--   4. queue_story_media() re-queues a URL that is already in the queue and
--      finished. Without this, two stories sharing one file lose the second
--      delete: the first is 'kept' (the second still uses the file) and the
--      second delete hit ON CONFLICT DO NOTHING, so the bytes stayed for ever.
--   5. A job_endpoints row 'media-delete-queue', copied from 'send-push' with
--      the path swapped (the 0087 trick), so it carries the same secret and
--      apikey and no new secret exists.
--   6. pg_cron every 30 minutes (:23 and :53, clear of the jobs on the hour,
--      :07 reconcile and 03:50 purge), guarded on pg_cron.
--
-- Queue status:
--   queued      waiting (or waiting to retry, see next_attempt_at)
--   processing  claimed by a run
--   done        bytes deleted, or already gone (outcome says which)
--   kept        still referenced; outcome says by what. Never deleted.
--   skipped     not an R2 URL of ours; nothing to do
--   failed      gave up after the attempt limit; last_error says why
--
-- ── Applying it ──
-- AFTER 0102 (and 0087 / 0090 for job_endpoints and pg_net_schema()). Safe to
-- re-run. Deploy the function first:
--   npx supabase functions deploy media-delete-queue --no-verify-jwt
-- then run this file. The schedule block is outside the transaction and does
-- nothing (with a notice) without pg_cron.
-- ============================================================

begin;

-- ── 1. Bookkeeping ──────────────────────────────────────
alter table public.media_delete_queue
  add column if not exists status          text        not null default 'queued',
  add column if not exists attempts        integer     not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists claimed_at      timestamptz,
  add column if not exists last_error      text,
  add column if not exists outcome         text,
  add column if not exists done_at         timestamptz;

-- Named, so a re-run can tell it is already there.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'media_delete_queue_status_check'
                    and conrelid = 'public.media_delete_queue'::regclass) then
    alter table public.media_delete_queue
      add constraint media_delete_queue_status_check
      check (status in ('queued', 'processing', 'done', 'kept', 'skipped', 'failed'));
  end if;
end $$;

create index if not exists media_delete_queue_due
  on public.media_delete_queue (next_attempt_at)
  where status in ('queued', 'processing');

-- RLS stays on with no policies (0102); only the service role and the
-- functions below touch it.
alter table public.media_delete_queue enable row level security;
revoke all on public.media_delete_queue from anon, authenticated;


-- ── 2. Claim a batch ────────────────────────────────────
-- p_dry: return what WOULD be claimed, without claiming it (no write, no
-- lock held past the call). Used by the function's ?dry=1.
create or replace function public.claim_media_delete_batch(
  p_limit integer default 100,
  p_dry   boolean default false
)
returns table (id bigint, url text, source text, attempts integer)
language plpgsql
volatile
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if p_dry then
    return query
      select q.id, q.url, q.source, q.attempts
        from public.media_delete_queue q
       where (q.status = 'queued' and q.next_attempt_at <= now())
          or (q.status = 'processing' and q.claimed_at < now() - interval '15 minutes')
       order by q.queued_at, q.id
       limit v_limit;
    return;
  end if;

  return query
    with due as (
      select q.id
        from public.media_delete_queue q
       where (q.status = 'queued' and q.next_attempt_at <= now())
          or (q.status = 'processing' and q.claimed_at < now() - interval '15 minutes')
       order by q.queued_at, q.id
       limit v_limit
       for update skip locked
    )
    update public.media_delete_queue m
       set status     = 'processing',
           claimed_at = now(),
           attempts   = m.attempts + 1
      from due
     where m.id = due.id
    returning m.id, m.url, m.source, m.attempts;
end;
$fn$;

revoke all on function public.claim_media_delete_batch(integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_media_delete_batch(integer, boolean) to service_role;


-- ── 3. Record a result ──────────────────────────────────
-- Only a row in 'processing' is changed, so a late answer from a run whose
-- claim was already recovered by another run cannot overwrite it twice in
-- a confusing way. Returns the row's new status (null if nothing changed).
--   done / kept / skipped  final; done_at stamped
--   retry                  back to 'queued' with backoff, or 'failed' at the limit
--   release                back to 'queued' now, attempt not counted (time budget)
create or replace function public.settle_media_delete(
  p_id           bigint,
  p_outcome      text,
  p_result       text    default null,
  p_error        text    default null,
  p_max_attempts integer default 8
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
begin
  if p_outcome in ('done', 'kept', 'skipped') then
    update public.media_delete_queue
       set status     = p_outcome,
           outcome    = p_result,
           last_error = p_error,
           done_at    = now(),
           claimed_at = null
     where id = p_id and status = 'processing'
    returning status into v_status;

  elsif p_outcome = 'retry' then
    update public.media_delete_queue
       set status          = case when attempts >= greatest(coalesce(p_max_attempts, 8), 1)
                                  then 'failed' else 'queued' end,
           last_error      = p_error,
           next_attempt_at = now() + least(interval '24 hours',
                                           interval '30 minutes' * power(2, greatest(attempts - 1, 0))),
           done_at         = case when attempts >= greatest(coalesce(p_max_attempts, 8), 1)
                                  then now() end,
           claimed_at      = null
     where id = p_id and status = 'processing'
    returning status into v_status;

  elsif p_outcome = 'release' then
    update public.media_delete_queue
       set status     = 'queued',
           attempts   = greatest(attempts - 1, 0),
           claimed_at = null
     where id = p_id and status = 'processing'
    returning status into v_status;

  else
    raise exception 'settle_media_delete: unknown outcome %', p_outcome;
  end if;

  return v_status;
end;
$fn$;

revoke all on function public.settle_media_delete(bigint, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.settle_media_delete(bigint, text, text, text, integer) to service_role;


-- ── 4. Re-queue a finished URL ──────────────────────────
-- Same as 0102, except that a URL already in the queue and finished is put
-- back to 'queued' instead of being ignored (see the header, item 4). A row
-- that is 'queued' or 'processing' is left as it is.
create or replace function public.queue_story_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.media_delete_queue as q (url, source)
  -- distinct: a story whose poster IS its media would otherwise propose the
  -- same row twice, which ON CONFLICT DO UPDATE refuses.
  select distinct u, 'stories'
    from unnest(array[old.media_url, old.poster_url]) as u
   where u is not null
  on conflict (url) do update
     set status          = 'queued',
         attempts        = 0,
         next_attempt_at = now(),
         claimed_at      = null,
         last_error      = null,
         outcome         = null,
         done_at         = null,
         queued_at       = now()
   where q.status in ('done', 'kept', 'skipped', 'failed');
  return null;
end;
$fn$;

revoke all on function public.queue_story_media() from public, anon, authenticated;

commit;


-- ── 5. Where the scheduled call points ──────────────────
-- Copied from send-push (0087), which is itself media-reconcile's row with the
-- path swapped: same x-reconcile-secret, same apikey. Re-running refreshes it.
-- If send-push is missing, media-reconcile's row is used instead.
insert into public.job_endpoints (name, url, headers)
select 'media-delete-queue', replace(url, '/send-push', '/media-delete-queue'), headers
  from public.job_endpoints where name = 'send-push'
on conflict (name) do update set url = excluded.url, headers = excluded.headers;

insert into public.job_endpoints (name, url, headers)
select 'media-delete-queue', replace(url, '/media-reconcile', '/media-delete-queue'), headers
  from public.job_endpoints where name = 'media-reconcile'
on conflict (name) do nothing;


-- ── 6. Schedule it ──────────────────────────────────────
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - NOTHING HAS BEEN SCHEDULED. Enable it in the Supabase dashboard (Database -> Extensions) and run this file again.';
    return;
  end if;

  perform cron.unschedule('media-delete-queue')
   where exists (select 1 from cron.job where jobname = 'media-delete-queue');

  perform cron.schedule(
    'media-delete-queue',
    '23,53 * * * *',
    $job$ select public.call_job_endpoint('media-delete-queue'); $job$
  );
end;
$sched$;


-- ── Checks (run after applying) ──
-- select 'queue has status column' as check,
--        case when exists (select 1 from information_schema.columns
--                           where table_schema = 'public' and table_name = 'media_delete_queue'
--                             and column_name = 'status')
--             then 'OK' else 'MISSING' end as result
-- union all
-- select 'queue status check constraint',
--        case when exists (select 1 from pg_constraint where conname = 'media_delete_queue_status_check')
--             then 'OK' else 'MISSING' end
-- union all
-- select 'claim RPC not callable by authenticated',
--        case when has_function_privilege('authenticated',
--                    'public.claim_media_delete_batch(integer, boolean)', 'execute')
--             then 'EXPOSED' else 'OK' end
-- union all
-- select 'settle RPC not callable by authenticated',
--        case when has_function_privilege('authenticated',
--                    'public.settle_media_delete(bigint, text, text, text, integer)', 'execute')
--             then 'EXPOSED' else 'OK' end
-- union all
-- select 'job_endpoints row',
--        case when exists (select 1 from public.job_endpoints
--                           where name = 'media-delete-queue' and url like '%/functions/v1/media-delete-queue')
--             then 'OK' else 'MISSING' end
-- union all
-- select 'queue has RLS',
--        case when (select relrowsecurity from pg_class where oid = 'public.media_delete_queue'::regclass)
--             then 'OK' else 'RLS OFF' end;
--
-- Where pg_cron is enabled:
-- select jobname, schedule, active from cron.job where jobname = 'media-delete-queue';
--
-- What the queue holds:
-- select status, outcome, count(*) from public.media_delete_queue group by 1, 2 order by 1, 2;
-- select id, url, attempts, last_error, next_attempt_at from public.media_delete_queue
--  where status in ('failed', 'queued') and last_error is not null order by id;
--
-- Trigger a run by hand ('queued' only means pg_net accepted it):
-- select public.call_job_endpoint('media-delete-queue');
