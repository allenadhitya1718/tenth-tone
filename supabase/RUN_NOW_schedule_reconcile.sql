-- RUN_NOW_schedule_reconcile.sql  (owner step: turn orphan-upload deletion ON)
--
-- Already done for you (migration 0138, applied to Mumbai):
--   * media-reconcile is deployed (rewritten: it NEVER lists the shared R2 bucket;
--     it only touches keys in THIS project's media_objects ledger that are
--     'pending', >= 24 h old, well-formed, and referenced by nothing).
--   * pg_cron job 'media-reconcile-daily' runs 04:10 UTC every day through the
--     existing job_endpoints secret (no new secret needed).
--   * reconcile_config.live = false, so every run is a DRY RUN: it only writes a
--     count to admin_logs (action = 'media_reconcile').
--
-- First dry run on 2026-10-19: pending_total 0, eligible orphans 0, nothing to delete.
--
-- WHEN you have looked at a few dry-run results and the numbers are what you
-- expect (check them with the query in step 1), run step 2 to enable deletion.
-- No secret is involved and none is printed.

-- 1. Look at the daily dry-run results (newest first)
select created_at,
       payload->>'dry_run'            as dry_run,
       payload->>'pending_total'      as pending_total,
       payload->>'eligible_orphans'   as eligible_orphans,
       payload->>'eligible_bytes'     as eligible_bytes,
       payload->>'skipped_referenced' as skipped_referenced,
       payload->>'deleted'            as deleted
  from public.admin_logs
 where action = 'media_reconcile'
 order by created_at desc
 limit 14;

-- 2. ENABLE deletion (run only after step 1 looks right)
-- update public.reconcile_config set live = true, updated_at = now() where id;

-- Batch size / minimum age (age can never go below 24 h):
-- update public.reconcile_config set batch_limit = 100, min_age_hours = 24, updated_at = now() where id;

-- KILL SWITCH: stop it completely (any time)
-- update public.reconcile_config set enabled = false, updated_at = now() where id;
-- Back to dry-run only:
-- update public.reconcile_config set live = false, updated_at = now() where id;
