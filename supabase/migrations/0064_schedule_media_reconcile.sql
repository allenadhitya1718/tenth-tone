-- 0064 — run the orphan sweeper on a schedule
--
-- media-reconcile deletes bytes nothing is accounting for: a phone that
-- uploaded and then died before confirming leaves a real object in R2 behind a
-- 'pending' row, and after 15 minutes that row stops counting toward usage
-- (0062). Storage that is billed and invisible. Deployed but never called, it
-- protects nothing.
--
-- ── Why not GitHub Actions ──
-- storage-alert is driven by .github/workflows/storage-alert.yml, and the
-- obvious move is to add a second job there. It would never fire. GitHub only
-- runs SCHEDULED workflows from a repository's DEFAULT branch; this workflow
-- lives on fixes/apk-review-and-security and main carries no workflows at all.
-- Manual dispatch works from any branch, which is why run #11 succeeded by
-- hand and misleadingly suggested the schedule was fine.
--
-- So the database calls the function itself. That needs pg_net, which is NOT
-- enabled on this project (it appears only in 0015, deliberately unapplied).
--
--   Supabase dashboard -> Database -> Extensions -> pg_net -> toggle on
--
-- Everything below is guarded: running this without pg_net records the
-- configuration and reports, rather than failing. The schedule then starts
-- working the moment the extension is enabled, with no re-run needed.

-- ── Where the scheduled calls point ──
-- RLS on with NO policies, deliberately: that denies every ordinary client
-- outright, which matters because this holds shared secrets. Only service_role
-- and the security-definer function below can read it.
create table if not exists public.job_endpoints (
  name    text primary key,
  url     text not null,
  -- Every header the call needs, including its shared secret. Supabase's
  -- gateway demands an apikey header even for a function deployed with
  -- --no-verify-jwt, so the anon key belongs here too — it is public by
  -- design, exactly like the one in the app.
  headers jsonb not null default '{}'::jsonb
);

alter table public.job_endpoints enable row level security;

-- ── Make one call ──
-- pg_net queues the request and returns immediately, so a slow or unreachable
-- function cannot hold up the cron worker.
--
-- The extension's schema is resolved rather than assumed: the dashboard toggle
-- installs pg_net into `extensions`, while a plain CREATE EXTENSION puts it in
-- `net`. Hardcoding either one breaks on the other.
create or replace function public.call_job_endpoint(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ep     public.job_endpoints%rowtype;
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_net';

  if v_schema is null then
    return 'pg_net not enabled — nothing called';
  end if;

  select * into v_ep from public.job_endpoints where name = p_name;
  if not found or v_ep.url is null or v_ep.url = '' then
    return 'endpoint ' || p_name || ' not configured';
  end if;

  execute format('select %I.http_post(url := $1, body := $2, headers := $3)', v_schema)
    using v_ep.url, '{}'::jsonb, v_ep.headers;

  return 'queued';
end;
$fn$;

revoke all on function public.call_job_endpoint(text) from public, anon, authenticated;

-- ── Schedule it ──
-- Hourly, because that interval IS the exposure window: it is the longest an
-- unaccounted object can sit in the bucket. At 24 runs a day this is 720 LIST
-- operations a month against a free allowance of a million.
--
-- :07 rather than :00 so it does not land with every other cron job on the
-- hour, and so it never overlaps the 07:00 storage-alert check.
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled — NOTHING HAS BEEN SCHEDULED.';
    return;
  end if;

  perform cron.unschedule('media-reconcile')
   where exists (select 1 from cron.job where jobname = 'media-reconcile');

  perform cron.schedule(
    'media-reconcile',
    '7 * * * *',
    $job$ select public.call_job_endpoint('media-reconcile'); $job$
  );
end;
$sched$;


-- =============================================================
-- FILL THIS IN, then run it. Replace both placeholders.
--
--   <RECONCILE_SECRET>  the same value set in Supabase -> Edge Functions ->
--                       Secrets. Both sides must match or every call is
--                       rejected with 401.
--   <ANON_KEY>          Project Settings -> API -> anon / public. Public by
--                       design; it is already in the app's own source.
-- =============================================================
insert into public.job_endpoints (name, url, headers)
values (
  'media-reconcile',
  'https://qnzgxihlrwanywndcmpf.supabase.co/functions/v1/media-reconcile',
  jsonb_build_object(
    'Content-Type',        'application/json',
    'x-reconcile-secret',  '<RECONCILE_SECRET>',
    'apikey',              '<ANON_KEY>',
    'Authorization',       'Bearer <ANON_KEY>'
  )
)
on conflict (name) do update
  set url = excluded.url, headers = excluded.headers;


-- ── Check it ──
--   select public.call_job_endpoint('media-reconcile');
--   -- 'queued', or a reason. 'pg_net not enabled' means the toggle is still off.
--
--   select jobname, schedule, active from cron.job order by jobname;
--   -- expect media-reconcile at '7 * * * *' alongside the existing jobs
--
-- pg_net is fire-and-forget, so 'queued' does not prove the function ran.
-- Confirm that separately:
--
--   select count(*) filter (where status = 'pending') as pending,
--          count(*) filter (where status = 'stored')  as stored
--     from public.media_objects;
--
-- Stale pending rows should disappear within an hour of the first run.
