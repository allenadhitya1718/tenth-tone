-- 0059 — warn the operators before storage fills, instead of after
--
-- The admin dashboard already shows a banner at 80% (admin.js), but that is
-- passive: it only appears once somebody opens the panel. If nobody logs in
-- for three weeks, nobody learns anything for three weeks. This pushes the
-- warning out instead, into the notifications every admin already receives.
--
-- Why it matters more than it used to: while files live in Supabase, hitting
-- the ceiling means uploads stop — annoying, free. Once media moves to
-- Cloudflare R2 there is a card on file and no spend cap, so crossing 10 GB
-- starts billing automatically. `global_max_bytes` is what stands in front of
-- that, and a limit nobody is watching is a limit that gets crossed.
--
-- ⚠ READ THIS BEFORE THE R2 MIGRATION ⚠
-- Everything below measures public.storage_used_bytes(), which sums
-- storage.objects — SUPABASE's table. After media moves to R2 that function
-- returns a nearly-empty bucket: usage reads ~2%, this job stays quiet, and
-- R2 fills to 10 GB in silence. A monitor pointed at the wrong source is worse
-- than none, because it reassures. Repoint storage_used_bytes() at R2 as part
-- of that migration and this job keeps working unchanged.

-- ── Remember what has already been said ──
-- Without this the job would repeat the same warning every single day at 71%,
-- and a daily alert that never changes is one people learn to ignore.
create table if not exists public.storage_alert_state (
  id            smallint primary key default 1 check (id = 1),
  last_band     smallint not null default 0,
  last_sent_at  timestamptz,
  -- Set when an in-app alert is written, cleared once an email has gone out.
  -- The two are deliberately decoupled: the database decides WHETHER to warn
  -- and writes the in-app notification itself, while sending mail needs an
  -- outside network call. Without this flag the email job would have to re-run
  -- the check, get "already notified", and stay silent for ever.
  email_pending boolean not null default false,
  email_payload jsonb
);

insert into public.storage_alert_state (id) values (1) on conflict (id) do nothing;

alter table public.storage_alert_state enable row level security;

drop policy if exists "storage_alert_state admin read" on public.storage_alert_state;
create policy "storage_alert_state admin read" on public.storage_alert_state
  for select to authenticated using (public.is_admin());

-- ── The check ──
-- Bands rather than a raw percentage, so the message can escalate and so
-- "already told you" is a simple comparison.
--   0: under 70%   1: 70-84%   2: 85-94%   3: 95%+
--
-- Speaks up when the band rises, and again every 24h while at 85% or above.
-- Falling back down resets the state, so a later climb warns again.
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
    -- Back under the first threshold: forget everything, so a future climb
    -- is announced rather than suppressed by a stale band.
    update public.storage_alert_state
       set last_band = 0, last_sent_at = null
     where id = 1;
    return jsonb_build_object('sent', false, 'pct', v_pct, 'band', 0);
  end if;

  if v_band > v_state.last_band then
    v_send := true;                                   -- it got worse
  elsif v_band >= 2 and (v_state.last_sent_at is null
        or v_state.last_sent_at < now() - interval '24 hours') then
    v_send := true;                                   -- serious, and a day has passed
  end if;

  if not v_send then
    return jsonb_build_object('sent', false, 'pct', v_pct, 'band', v_band, 'reason', 'already_notified');
  end if;

  -- One notification per admin. actor_id is the admin themselves because the
  -- column is not nullable and no person caused this; the payload carries the
  -- meaning, exactly as the new_login alerts already do.
  insert into public.notifications (user_id, actor_id, type, payload)
  select p.id, p.id, 'system',
         jsonb_build_object(
           'kind',      'storage_alert',
           'pct',       v_pct,
           'used',      v_used,
           'limit',     v_limit,
           'band',      v_band
         )
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

  return jsonb_build_object('sent', true, 'pct', v_pct, 'band', v_band, 'admins_notified', v_admins);
end;
$fn$;

grant execute on function public.check_storage_alert() to authenticated;


-- ── Hand the pending alert to whatever sends mail ──
-- Returns the alert and clears the flag in one statement, so two mailers
-- running at once cannot both send: the second sees nothing pending. Returns
-- null when there is nothing to send, which is the normal case.
--
-- Also returns the admin addresses, read from auth.users — which is why this
-- is security definer and granted to service_role only. An ordinary signed-in
-- user must never be able to list operator emails.
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

  select array_agg(u.email)
    into v_emails
    from auth.users u
    join public.profiles p on p.id = u.id
   where p.is_admin and u.email is not null;

  return v_payload || jsonb_build_object('recipients', to_jsonb(coalesce(v_emails, '{}')));
end;
$fn$;

revoke all on function public.claim_storage_alert_email() from public, anon, authenticated;
grant execute on function public.claim_storage_alert_email() to service_role;

-- ── Schedule it ──
-- pg_cron is already enabled and running two jobs (see 0051). Guarded the same
-- way, so running this file without the extension reports rather than fails.
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled — NOTHING HAS BEEN SCHEDULED. Enable it in Database -> Extensions and re-run.';
    return;
  end if;

  perform cron.unschedule('storage-alert-check')
   where exists (select 1 from cron.job where jobname = 'storage-alert-check');

  -- 07:00 UTC daily: 10am in Riyadh, so a warning is waiting at the start of
  -- the working day rather than in the middle of the night.
  perform cron.schedule(
    'storage-alert-check',
    '0 7 * * *',
    $job$ select public.check_storage_alert(); $job$
  );
end;
$sched$;

-- ── After running ──
--   select public.check_storage_alert();          -- try it now
--   select jobname, schedule from cron.job;       -- expect storage-alert-check
--
-- ⚠ It notifies profiles where is_admin is true. If no account has that flag
-- the job runs, reports admins_notified = 0, and nobody hears anything.
-- Check with:  select count(*) from public.profiles where is_admin;
