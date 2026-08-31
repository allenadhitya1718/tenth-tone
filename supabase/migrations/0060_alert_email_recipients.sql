-- 0060 — send the storage alert to chosen addresses, from the database itself
--
-- Two gaps in 0059.
--
-- 1. RECIPIENTS. claim_storage_alert_email() reads addresses out of auth.users
--    for accounts with is_admin, so it can only ever reach people who have a
--    FLYP login. A shared mailbox like admin@flyp-sa.com has no account and
--    could never be told. Addresses can now be added explicitly.
--
-- 2. SCHEDULING. The email half was to be triggered by a GitHub Actions cron,
--    but GitHub only runs scheduled workflows from a repository's DEFAULT
--    branch. The workflow lives on fixes/apk-review-and-security and main has
--    no workflows at all, so it would never have fired — the same rule that
--    stopped us dispatching the APK build by hand. Rather than merge to main
--    just for a scheduler, the database calls the Edge Function itself.
--
-- That needs pg_net, which is NOT enabled on this project (it appears only in
-- 0015, deliberately unapplied). Enable it the same way pg_cron was: Supabase
-- dashboard -> Database -> Extensions -> pg_net -> toggle on, THEN run this.
-- Everything here is guarded, so running it without pg_net configures the
-- recipients and reports rather than failing — the in-app alert is unaffected
-- either way.

-- ── Where to send, and how to reach the mailer ──
-- RLS is enabled with NO policies on purpose: that denies every ordinary
-- client outright. Only service_role and the security-definer functions below
-- can read it, which matters because it holds the shared secret.
create table if not exists public.alert_config (
  id               smallint primary key default 1 check (id = 1),
  function_url     text,
  shared_secret    text,
  -- Addresses that are not FLYP accounts. Merged with the admin addresses,
  -- so an operator who does have a login is not told twice.
  extra_recipients text[] not null default '{}'
);

insert into public.alert_config (id) values (1) on conflict (id) do nothing;

alter table public.alert_config enable row level security;

-- ── Recipients: admin accounts plus the extras ──
create or replace function public.claim_storage_alert_email()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_payload jsonb;
  v_emails  text[];
begin
  update public.storage_alert_state
     set email_pending = false
   where id = 1 and email_pending
  returning email_payload into v_payload;

  if v_payload is null then
    return null;
  end if;

  -- distinct, so somebody listed in extra_recipients who also has an admin
  -- login receives one email rather than two.
  select array_agg(distinct e)
    into v_emails
    from (
      select u.email as e
        from auth.users u
        join public.profiles p on p.id = u.id
       where p.is_admin and u.email is not null
      union
      select unnest(extra_recipients) from public.alert_config where id = 1
    ) t
   where e is not null and e <> '';

  return v_payload || jsonb_build_object('recipients', to_jsonb(coalesce(v_emails, '{}')));
end;
$fn$;

revoke all on function public.claim_storage_alert_email() from public, anon, authenticated;
grant execute on function public.claim_storage_alert_email() to service_role;

-- ── Ask the Edge Function to send ──
-- pg_net queues the request and returns immediately, so a slow or unreachable
-- mailer cannot hold up the cron job that called it.
--
-- The schema is resolved rather than assumed: Supabase's dashboard toggle
-- installs pg_net into `extensions`, while a plain CREATE EXTENSION puts it in
-- `net`. Hardcoding either one breaks on the other.
create or replace function public.send_storage_alert_email()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cfg    public.alert_config%rowtype;
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_net';

  if v_schema is null then
    return 'pg_net not enabled — email skipped, in-app alert unaffected';
  end if;

  select * into v_cfg from public.alert_config where id = 1;
  if v_cfg.function_url is null or v_cfg.shared_secret is null then
    return 'alert_config not filled in — email skipped';
  end if;

  execute format(
    'select %I.http_post(url := $1, body := $2, headers := $3)', v_schema
  ) using
    v_cfg.function_url,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type',   'application/json',
      'x-alert-secret', v_cfg.shared_secret
    );

  return 'queued';
end;
$fn$;

revoke all on function public.send_storage_alert_email() from public, anon, authenticated;

-- ── Have the daily check ask for the email too ──
-- Only where it already decided to warn, so this adds no new decision and
-- cannot cause an email the in-app notification did not also produce.
create or replace function public.check_storage_alert()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_used   bigint;
  v_limit  bigint;
  v_pct    numeric;
  v_band   smallint;
  v_state  public.storage_alert_state%rowtype;
  v_send   boolean := false;
  v_admins integer := 0;
  v_mail   text := 'not attempted';
begin
  select global_max_bytes into v_limit from public.app_limits where id = 1;
  if v_limit is null or v_limit <= 0 then
    return jsonb_build_object('sent', false, 'reason', 'no_limit_configured');
  end if;

  v_used := public.storage_used_bytes();
  v_pct  := round((v_used::numeric / v_limit::numeric) * 100, 1);

  v_band := case
    when v_pct >= 95 then 3
    when v_pct >= 85 then 2
    when v_pct >= 70 then 1
    else 0
  end;

  select * into v_state from public.storage_alert_state where id = 1;

  if v_band = 0 then
    update public.storage_alert_state
       set last_band = 0, last_sent_at = null
     where id = 1;
    return jsonb_build_object('sent', false, 'pct', v_pct, 'band', 0);
  end if;

  if v_band > v_state.last_band then
    v_send := true;
  elsif v_band >= 2 and (v_state.last_sent_at is null
        or v_state.last_sent_at < now() - interval '24 hours') then
    v_send := true;
  end if;

  if not v_send then
    return jsonb_build_object('sent', false, 'pct', v_pct, 'band', v_band, 'reason', 'already_notified');
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  select p.id, p.id, 'system',
         jsonb_build_object('kind', 'storage_alert', 'pct', v_pct,
                            'used', v_used, 'limit', v_limit, 'band', v_band)
    from public.profiles p
   where p.is_admin;

  get diagnostics v_admins = row_count;

  update public.storage_alert_state
     set last_band     = v_band,
         last_sent_at  = now(),
         email_pending = true,
         email_payload = jsonb_build_object('pct', v_pct, 'used', v_used,
                                            'limit', v_limit, 'band', v_band)
   where id = 1;

  -- Mail is a nicety on top of a notification that has already been written.
  -- A failure here must not roll back the alert, so it is swallowed and
  -- reported rather than raised.
  begin
    v_mail := public.send_storage_alert_email();
  exception when others then
    v_mail := 'failed: ' || sqlerrm;
  end;

  return jsonb_build_object('sent', true, 'pct', v_pct, 'band', v_band,
                            'admins_notified', v_admins, 'email', v_mail);
end;
$fn$;

grant execute on function public.check_storage_alert() to authenticated;

-- =============================================================
-- SET YOUR ADDRESSES AND THE MAILER DETAILS
--
-- Replace the secret with a long random string of your own, and use the same
-- value for ALERT_SECRET in Supabase -> Edge Functions -> Secrets.
--
-- allenadhitya1718@gmail.com is already covered by being an admin account,
-- but it is listed anyway so the alert still arrives if that flag is ever
-- turned off.
-- =============================================================

update public.alert_config
   set function_url     = 'https://qnzgxihlrwanywndcmpf.supabase.co/functions/v1/storage-alert',
       shared_secret    = 'CHANGE-ME-to-a-long-random-string',
       extra_recipients = array['admin@flyp-sa.com', 'allenadhitya1718@gmail.com']
 where id = 1;

-- ── Check it ──
--   select public.send_storage_alert_email();   -- expect 'queued', or a reason
--   select public.check_storage_alert();        -- expect sent:false at 23%
--
-- To force a real end-to-end test, drop the ceiling so the current usage
-- crosses 70%, run the check, then put it back:
--   update public.app_limits set global_max_bytes = 250000000 where id = 1;
--   select public.check_storage_alert();        -- expect sent:true, email:'queued'
--   update public.app_limits set global_max_bytes = 900000000 where id = 1;
--   update public.storage_alert_state set last_band = 0, last_sent_at = null where id = 1;
