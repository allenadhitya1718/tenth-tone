-- ============================================================
-- 0051_enable_scheduled_jobs.sql
--
-- Two nightly jobs were written and registered, and neither has ever run.
--
-- 0032 and 0034 both wrapped their cron.schedule call in
--
--     if exists (select 1 from pg_extension where extname = 'pg_cron') then
--
-- which is sensible — it stops the migration failing on a project without
-- the extension. But pg_cron was never enabled, so both silently did
-- nothing, and nothing ever said so. A guard that degrades quietly is only
-- safe if somebody later checks whether it degraded.
--
-- What has not been happening:
--
--   purge_scheduled_deletions()  Deleting your account sets a 30-day timer
--                                and this is what fires at the end of it.
--                                Without it an account is marked for
--                                deletion and then simply stays. Both app
--                                stores require deletion to complete, and
--                                in several jurisdictions so does the law.
--
--   purge_stale_locations()      GPS history older than seven days.
--
-- The app tells people both of these happen, in its own privacy screen:
-- "your data is deleted within 30 days ... location records are deleted
-- within seven days". Right now that is not true. Nobody has been harmed
-- yet — there are currently zero accounts awaiting deletion — but the
-- first person to delete their account would have been.
-- ============================================================


-- ── Enable the scheduler ─────────────────────────────────
-- IN PRACTICE (2026-08-30) this statement did NOT enable it on Supabase.
-- It ran without complaint and pg_cron was still absent, so the block below
-- skipped itself and reported "jobs registered: none".
--
-- The route that worked: Supabase dashboard -> Database -> Extensions ->
-- pg_cron -> toggle on. THEN run this file, which registers the jobs.
--
-- Left here because it is harmless and does work on a plain Postgres, but
-- do not trust it to have done anything — read the check at the bottom.
create extension if not exists pg_cron;


-- ── Register the jobs ────────────────────────────────────
-- Unscheduling first makes this safe to re-run: cron.schedule with an
-- existing name updates in place on newer versions but errors on older
-- ones, and there is no reason to depend on which.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is still not enabled - enable it in the Supabase dashboard (Database -> Extensions) and run this file again. NOTHING HAS BEEN SCHEDULED.';
    return;
  end if;

  begin perform cron.unschedule('purge-scheduled-deletions'); exception when others then null; end;
  begin perform cron.unschedule('purge-stale-locations');     exception when others then null; end;

  -- 03:30 daily — finishes account deletions past their grace period.
  perform cron.schedule(
    'purge-scheduled-deletions', '30 3 * * *',
    'select public.purge_scheduled_deletions()'
  );

  -- 03:00 daily — drops location history older than seven days.
  perform cron.schedule(
    'purge-stale-locations', '0 3 * * *',
    'select public.purge_stale_locations()'
  );

  raise notice 'Scheduled: purge-scheduled-deletions (03:30) and purge-stale-locations (03:00).';
end $$;


-- ── If the scheduler cannot be enabled ───────────────────
-- Both functions are ordinary and can be run by hand, or from anywhere that
-- can reach the database on a timer. Nothing about them requires pg_cron;
-- it was only ever the convenient way to call them.
--
--     select public.purge_scheduled_deletions();
--     select public.purge_stale_locations();
--
-- Running them manually once a week is far better than not at all. Set a
-- calendar reminder if it comes to that — an unkept deletion promise is the
-- kind of thing that matters most precisely when nobody is watching.


-- ── Did it work? ─────────────────────────────────────────
select 'pg_cron enabled' as check,
       coalesce((select 'YES' from pg_extension where extname = 'pg_cron'),
                'NO - use the dashboard, then re-run this file') as result
union all
select 'jobs registered',
       coalesce((select string_agg(jobname || ' @ ' || schedule, ' | ' order by jobname)
                   from cron.job
                  where jobname in ('purge-scheduled-deletions', 'purge-stale-locations')),
                'none');
